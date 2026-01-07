# Copilot CLI Agent

An intelligent CLI coding assistant powered by Microsoft 365 Copilot. Similar to Claude Code, but uses your organization's M365 Copilot subscription.

## Features

- 🤖 Interactive AI-powered coding assistant
- 📝 Create and modify files with smart search/replace patching
- 🔧 Execute shell commands and Python scripts
- 🔐 Windows Integrated Authentication (with fallback)
- ⚡ Streaming responses for real-time feedback
- 🛠️ Extensible tool system
- 📊 **Context Budget Management** - Intelligent token allocation across conversation sections
- 🚀 **Parallel Subagent System** - Automatic task delegation to specialized agents

## Subagent System

The agent can spawn autonomous subagents to handle specific tasks:

- **Parallel Processing**: For tasks like "for each file, add tests", the agent spawns multiple parallel subagents
- **Specialized Roles**: Test writer, investigator, refactorer, documenter, and fixer agents
- **Mandatory Delegation**: High-priority patterns (investigation, debugging, parallel work) automatically trigger mandatory delegation
- **Smart Detection**: Pattern matching identifies when delegation improves efficiency

### Mandatory vs Suggested Delegation

The system operates in two modes:

| Mode | When It Triggers | Agent Behavior | Display |
|------|------------------|----------------|---------|
| **Mandatory** | High-priority patterns (e.g., "investigate", "for each file") | Agent MUST spawn subagents | ⚠️ Yellow warning |
| **Suggested** | Medium/low priority patterns (e.g., "write tests", "refactor") | Agent MAY spawn subagents | 💡 Gray suggestion |

**Examples of Mandatory Delegation:**
- "For each module, add unit tests" → Spawns parallel test-writers
- "Investigate why the API returns 500" → Spawns investigator
- "Debug the memory leak" → Spawns investigator
- "Fix the bug in the login module" → Spawns fixer

**Examples of Suggested Delegation:**
- "Write tests for utils.ts" → Agent may choose to handle directly
- "Refactor the code structure" → Agent delegates if complex
- "Update the documentation" → Agent delegates if large

For detailed information, see [docs/mandatory-delegation.md](docs/mandatory-delegation.md).

## Context Budget System

The agent includes a sophisticated context budget management system that intelligently allocates tokens across different conversation sections. This ensures optimal use of the LLM's context window while preventing overflow errors.

### Key Features

- **Smart Allocation**: Automatically distributes tokens across 8 context sections (system prompt, memory, recent messages, etc.)
- **Dynamic Adjustment**: Recalculates budgets when switching between models with different context limits
- **Budget Tracking**: Monitors token usage and provides warnings when approaching limits
- **Integration**: Works seamlessly with ConversationManager and SmartCompressor

### Budget Sections

```
┌─────────────────────────┬─────────┬────────┐
│ Section                 │ Default │ Usage  │
├─────────────────────────┼─────────┼────────┤
│ recentMessages          │   35%   │ Raw conversation history │
│ systemPrompt            │   15%   │ Instructions & capabilities │
│ conversationSummary     │   15%   │ Compressed history │
│ memory                  │   10%   │ Persistent context │
│ retrievedContext        │   10%   │ Archived content │
│ goal                    │    5%   │ Current mission │
│ workingState            │    5%   │ Active tasks/errors │
│ scaffoldingReminder     │    5%   │ Meta-instructions │
└─────────────────────────┴─────────┴────────┘
```

### Example Allocations

For an 8K context model (6,400 token budget):
- **Recent Messages**: 2,240 tokens - maintains conversation flow
- **System Prompt**: 960 tokens - comprehensive instructions
- **Memory**: 640 tokens - facts, preferences, decisions
- **Conversation Summary**: 960 tokens - compressed history
- **Retrieved Context**: 640 tokens - archival content
- **Other sections**: 960 tokens - goal, working state, scaffolding

### Budget Warnings

The system monitors usage and provides warnings:
- **Normal**: < 80% used
- **Warning**: 80-90% used - consider compression
- **Critical**: > 90% used - compression required

```bash
[Budget] Used 5300 / 6400 tokens (83%)
[Budget] Warning: 83% of token budget used. 1100 tokens remaining.
```

For comprehensive documentation, see [docs/context-budget.md](docs/context-budget.md).

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

> **For detailed setup instructions with troubleshooting, see [docs/azure-setup.md](docs/azure-setup.md)**

Quick setup:

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
- **grep_repo**: Search the repository (read-only, rg/grep)
- **explore_codebase**: Spawn read-only explorer subagent and return structured findings
- **debug_scaffold**: Scaffold a hypothesis-driven debugging task tree
- **record_experiment_result**: Record experiment outcomes against tasks (persistent debugging trail)

## Examples

```bash
# Interactive session
$ copilot-cli
You: Create a simple Python script that prints "Hello World"
