# Azure AD App Registration Setup for Copilot CLI

This guide walks you through configuring an Azure AD app registration to use the Microsoft 365 Copilot Chat API.

## Prerequisites

- **Microsoft 365 Copilot License** - You must have a Copilot license assigned to your account
- **Azure AD Admin Access** - Admin consent is required for some permissions
- **Microsoft 365 E3/E5** (or equivalent) subscription

## Step 1: Create App Registration

1. Go to [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations**
2. Click **+ New registration**
3. Configure:
   - **Name**: `Copilot CLI`
   - **Supported account types**: `Accounts in this organizational directory only`
   - **Redirect URI**: Leave blank (not needed for device code flow)
4. Click **Register**
5. **Copy the Application (client) ID** - you'll need this

## Step 2: Enable Public Client Flow

1. In your app registration, go to **Authentication**
2. Scroll down to **Advanced settings**
3. Set **Allow public client flows** to **Yes**
4. Click **Save**

## Step 3: Add API Permissions

1. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**
2. Add ALL of these permissions:

   | Permission | Description |
   |------------|-------------|
   | `Sites.Read.All` | Read items in all site collections |
   | `Mail.Read` | Read user mail |
   | `People.Read.All` | Read all users' relevant people lists |
   | `OnlineMeetingTranscript.Read.All` | Read all transcripts of online meetings |
   | `Chat.Read` | Read user chat messages |
   | `ChannelMessage.Read.All` | Read all channel messages |
   | `ExternalItem.Read.All` | Read all external items |

3. Click **Add permissions**

## Step 4: Grant Admin Consent

1. Still in **API permissions**, click **Grant admin consent for [Your Organization]**
2. Click **Yes** to confirm
3. Verify all permissions show a green checkmark under "Status"

> **Note**: If you're not an admin, you'll need to request consent from your IT admin.

## Step 5: Get Your Tenant ID

1. Go to **Overview** in your app registration
2. **Copy the Directory (tenant) ID**

## Step 6: Configure the CLI

Create a `.env` file in the `copilot-cli` directory:

```bash
# In C:\dev\copilot-cli\.env
AZURE_CLIENT_ID=your-application-client-id-here
AZURE_TENANT_ID=your-directory-tenant-id-here
```

Or set environment variables:

```powershell
# PowerShell
$env:AZURE_CLIENT_ID = "your-application-client-id-here"
$env:AZURE_TENANT_ID = "your-directory-tenant-id-here"
```

```bash
# Git Bash / WSL
export AZURE_CLIENT_ID="your-application-client-id-here"
export AZURE_TENANT_ID="your-directory-tenant-id-here"
```

## Step 7: Clear Cache and Re-authenticate

```bash
# Delete the cached token (scopes changed)
rm -rf "$LOCALAPPDATA/copilot-cli"

# Start the CLI
npx copilot-cli chat
```

## Troubleshooting

### 401 Unauthorized
- Verify admin consent was granted for all permissions
- Check that you have a Microsoft 365 Copilot license
- Ensure the AZURE_CLIENT_ID and AZURE_TENANT_ID are correct
- Try clearing the token cache and re-authenticating

### 403 Forbidden
- Your account may not have a Copilot license
- The Copilot API may not be enabled for your organization
- Some permissions may require additional admin consent

### 404 Not Found
- The Copilot Chat API is in preview and may not be available in all regions
- Ensure your organization has Microsoft 365 Copilot enabled

## Important Notes

- The Copilot Chat API is currently in **beta/preview**
- All API calls respect your organization's security policies (Conditional Access, sensitivity labels, etc.)
- Each user accessing the API needs a Microsoft 365 Copilot license

## References

- [Microsoft 365 Copilot APIs Overview](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/copilot-apis-overview)
- [Copilot Chat API Documentation](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/api/ai-services/chat/overview)
- [Microsoft Graph Authentication](https://learn.microsoft.com/en-us/graph/auth/)
