#!/usr/bin/env bash
set -euo pipefail

WORKIQ_APP_ID='fdcc1f02-fc51-4226-8753-f668596af7f7'
VSCODE_APP_ID='aebc6443-996d-45c2-90f0-388ff96faa56'
DESIRED_SCOPES='WorkIQ.Read WorkIQ.Act WorkIQSettings.Read.All WorkIQSettings.ReadWrite.All WorkIQAgent.Ask.Selected WorkIQAgent.Ask'
GRAPH_URL='https://graph.microsoft.com/v1.0'
UUID_PATTERN='^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'

usage() {
  cat <<'USAGE'
Usage: bootstrap-tenant.sh [--dry-run|--apply] <tenant-id>

Preview Work IQ service principals and VS Code tenant-wide delegated consent.
Preview is the default and requires an existing login to the selected tenant.
--apply permits tenant login, service principal creation, and consent changes.
USAGE
}

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
log() { printf '%s\n' "$1" >&2; }

az_tsv() {
  az "$@" --output tsv | awk '{ sub(/\r$/, ""); print }'
}

normalize_scopes() {
  printf '%s\n' "$1" | tr '[:space:]' '\n' | awk 'NF && !seen[$0]++' | paste -sd ' ' -
}

ensure_login() {
  local current_tenant
  if ! current_tenant="$(az_tsv account show --query tenantId)"; then
    log 'Could not read the active Azure CLI account.'
    current_tenant=''
  fi
  current_tenant="$(printf '%s' "$current_tenant" | tr '[:upper:]' '[:lower:]')"
  if [[ "$current_tenant" != "$TENANT_ID" ]]; then
    if [[ "$DRY_RUN" == true ]]; then
      fail "Preview requires an existing login to tenant $TENANT_ID. Run az login --tenant $TENANT_ID --allow-no-subscriptions first."
    fi
    log "Signing in to tenant $TENANT_ID..."
    az login --tenant "$TENANT_ID" --allow-no-subscriptions --output none
    current_tenant="$(az_tsv account show --query tenantId)"
    current_tenant="$(printf '%s' "$current_tenant" | tr '[:upper:]' '[:lower:]')"
  fi
  [[ "$current_tenant" == "$TENANT_ID" ]] || fail 'Azure CLI did not select the requested tenant; no directory changes were attempted.'
}

ensure_sp() {
  local app_id="$1" label="$2" sp_id
  sp_id="$(az_tsv ad sp list --filter "appId eq '$app_id'" --query '[].id')" || return
  if [[ -z "$sp_id" ]]; then
    if [[ "$DRY_RUN" == true ]]; then
      log "Would create the service principal for $label ($app_id)."
      return 0
    fi
    log "Creating the service principal for $label ($app_id)..."
    sp_id="$(az_tsv ad sp create --id "$app_id" --query id)" || return
  else
    log "Service principal already exists for $label: $sp_id"
  fi
  [[ "$sp_id" =~ $UUID_PATTERN ]] || fail "Expected one valid service principal object ID for $label."
  printf '%s\n' "$sp_id"
}

DRY_RUN=true
MODE_SELECTED=false
TENANT_ID=''
for argument in "$@"; do
  case "$argument" in
    --help|-h) usage; exit 0 ;;
    --dry-run|--apply)
      [[ "$MODE_SELECTED" == false ]] || fail 'Select only one of --dry-run and --apply.'
      MODE_SELECTED=true
      if [[ "$argument" == --apply ]]; then DRY_RUN=false; fi
      ;;
    -*) fail "Unknown option: $argument" ;;
    *)
      [[ -n "$argument" ]] || fail 'Tenant ID cannot be empty.'
      [[ -z "$TENANT_ID" ]] || fail 'Supply exactly one tenant ID.'
      TENANT_ID="$argument"
      ;;
  esac
done
[[ "$TENANT_ID" =~ $UUID_PATTERN ]] || { usage >&2; fail 'An explicit tenant UUID is required.'; }
TENANT_ID="$(printf '%s' "$TENANT_ID" | tr '[:upper:]' '[:lower:]')"
command -v az >/dev/null 2>&1 || fail 'Azure CLI (az) is required.'

if [[ "$DRY_RUN" == true ]]; then log 'DRY RUN: no login, service principal, or consent changes will be made.'; fi
ensure_login
WORKIQ_SP_ID="$(ensure_sp "$WORKIQ_APP_ID" 'Work IQ')"
VSCODE_SP_ID="$(ensure_sp "$VSCODE_APP_ID" 'Visual Studio Code')"

if [[ -z "$WORKIQ_SP_ID" || -z "$VSCODE_SP_ID" ]]; then
  log 'Would create the tenant-wide delegated grant after the missing service principals exist; grant lookup is deferred.'
else
  log 'Checking tenant-wide delegated consent (VS Code -> Work IQ)...'
  GRANT_ID="$(az_tsv rest --method GET \
    --url "$GRAPH_URL/oauth2PermissionGrants?\$filter=clientId%20eq%20'$VSCODE_SP_ID'%20and%20resourceId%20eq%20'$WORKIQ_SP_ID'%20and%20consentType%20eq%20'AllPrincipals'" \
    --query 'value[].id')"
  if [[ -z "$GRANT_ID" ]]; then
    if [[ "$DRY_RUN" == true ]]; then
      log "Would create a tenant-wide delegated grant with scopes: $DESIRED_SCOPES"
    else
      az rest --method POST --url "$GRAPH_URL/oauth2PermissionGrants" \
        --headers 'Content-Type=application/json' \
        --body "{\"clientId\":\"$VSCODE_SP_ID\",\"consentType\":\"AllPrincipals\",\"principalId\":null,\"resourceId\":\"$WORKIQ_SP_ID\",\"scope\":\"$DESIRED_SCOPES\"}" \
        --output none
      log 'Created the tenant-wide delegated consent grant.'
    fi
  else
    [[ "$GRANT_ID" =~ ^[a-zA-Z0-9._~=-]+$ ]] || fail 'Expected one valid tenant-wide delegated grant ID; refusing an ambiguous response.'
    EXISTING_SCOPES="$(az_tsv rest --method GET --url "$GRAPH_URL/oauth2PermissionGrants/$GRANT_ID" --query scope)"
    EXISTING_SCOPES="$(normalize_scopes "$EXISTING_SCOPES")"
    MERGED_SCOPES="$(normalize_scopes "$EXISTING_SCOPES $DESIRED_SCOPES")"
    if [[ "$MERGED_SCOPES" == "$EXISTING_SCOPES" ]]; then
      log 'Grant already contains all required scopes.'
    elif [[ "$DRY_RUN" == true ]]; then
      log "Would update the tenant-wide grant to scopes: $MERGED_SCOPES"
    else
      [[ "$MERGED_SCOPES" != *[[:cntrl:]]* ]] || fail 'Grant scopes contain unsupported control characters.'
      SCOPE_JSON="${MERGED_SCOPES//\\/\\\\}"
      SCOPE_JSON="${SCOPE_JSON//\"/\\\"}"
      az rest --method PATCH --url "$GRAPH_URL/oauth2PermissionGrants/$GRANT_ID" \
        --headers 'Content-Type=application/json' --body "{\"scope\":\"$SCOPE_JSON\"}" --output none
      log 'Updated the tenant-wide grant scopes.'
    fi
  fi
fi

printf 'Tenant:        %s\n' "$TENANT_ID"
printf 'Work IQ SP ID: %s\n' "${WORKIQ_SP_ID:-not created (dry run)}"
printf 'VS Code SP ID: %s\n' "${VSCODE_SP_ID:-not created (dry run)}"
if [[ "$DRY_RUN" == true ]]; then
  printf 'Dry run complete. Use --apply to make the reported changes.\n'
else
  printf 'Done. You can now retry Work IQ auth in VS Code.\n'
fi
