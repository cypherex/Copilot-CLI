# Copilot CLI Agent

An intelligent CLI coding assistant powered by Microsoft 365 Copilot. Similar to Claude Code, but uses your organization's M365 Copilot subscription.

## Features

- 🤖 Interactive AI-powered coding assistant
- 📝 Create and modify files with smart search/replace patching
- 🔧 Execute shell commands and Python scripts
- 🔐 Windows Integrated Authentication (with fallback)
- ⚡ Streaming responses for real-time feedback
- 🛠️ Extensible tool system

## Prerequisites

- Node.js 18 or higher
- Microsoft 365 Copilot license
- Azure AD app registration (see setup below)
- Windows (for integrated auth) or any OS (device code flow)

## Installation

```bash
npm install -g copilot-cli
```

Or for local development:

```bash
git clone <repo-url>
cd copilot-cli
npm install
npm link
```

## Setup

### 1. Azure AD App Registration

1. Go to [Azure Portal](https://portal.azure.com) → Azure Active Directory → App registrations
2. Click "New registration"
3. Configure:
   - Name: "Copilot CLI"
   - Account types: "Accounts in this organizational directory only"
   - Redirect URI: Leave blank
4. After creation:
   - Copy **Application (client) ID**
   - Copy **Directory (tenant) ID**
5. Under "Authentication":
   - Add platform: "Mobile and desktop applications"
   - Add redirect URI: `http://localhost`
   - Enable "Allow public client flows" ✓
6. Under "API permissions":
   - Add: Microsoft Graph → Delegated → `User.Read`
   - Add: Microsoft Graph → Delegated → `Copilot.Chat` (if available)
   - Grant admin consent if required

### 2. Configure Environment

Create a `.env` file in your project root or set environment variables:

```bash
AZURE_CLIENT_ID=your-client-id-here
AZURE_TENANT_ID=your-tenant-id-here
```

Or use the config command:

```bash
copilot-cli config --set auth.clientId=your-client-id
copilot-cli config --set auth.tenantId=your-tenant-id
```

## Usage

### Interactive Chat

Start an interactive session:

```bash
copilot-cli
# or
copilot-cli chat
```

Special commands:
- `/help` - Show help
- `/clear` - Clear conversation history
- `/exit` - Exit the session

### One-Shot Questions

Ask a single question:

```bash
copilot-cli ask "How do I create a REST API in Node.js?"
```

### Configuration

View configuration:

```bash
copilot-cli config --list
```

Get a specific value:

```bash
copilot-cli config --get auth.clientId
```

Set a value:

```bash
copilot-cli config --set llm.temperature=0.8
```

## Available Tools

The agent has access to these tools:

- **create_file**: Create new files with content
- **patch_file**: Modify files using exact search/replace
- **read_file**: Read file contents (with optional line ranges)
- **execute_bash**: Run shell commands (including Python scripts)
- **list_files**: List files using glob patterns

## Examples

```bash
# Interactive session
$ copilot-cli
You: Create a simple Python script that prints "Hello World"