# CODEX - AI Execution Agent

## 1. Project Overview

**Project Name:** CODEX
**Type:** SaaS Web Application (Next.js)
**Core Functionality:** AI-powered execution agent that proposes and executes real actions across connected productivity tools (Gmail, Google Calendar, Notion, etc.) through a controlled human-in-the-loop approval workflow.
**Target Users:** Professionals and teams seeking to automate operational tasks while maintaining full control over AI executions.

---

## 2. UI/UX Specification

### Layout Structure

**Page Sections:**
- **Sidebar (fixed left, 280px):** Navigation, workspace selector, connected apps status
- **Main Content Area (flex-grow):** Dynamic content based on current view
- **Header Bar (64px):** Context title, user menu, notifications

**Responsive Breakpoints:**
- Desktop: ≥1280px (full sidebar)
- Tablet: 768px-1279px (collapsible sidebar)
- Mobile: <768px (bottom navigation, hamburger menu)

### Visual Design

**Color Palette:**
- Background Primary: `#0A0A0B` (near black)
- Background Secondary: `#141416` (dark gray)
- Background Tertiary: `#1C1C1F` (card backgrounds)
- Border: `#2A2A2E` (subtle borders)
- Text Primary: `#FAFAFA` (white)
- Text Secondary: `#A1A1AA` (muted gray)
- Text Tertiary: `#71717A` (disabled/hint)
- Accent Primary: `#10B981` (emerald green - actions approved)
- Accent Warning: `#F59E0B` (amber - pending approval)
- Accent Danger: `#EF4444` (red - rejected/error)
- Accent Info: `#3B82F6` (blue - informational)
- Accent Purple: `#8B5CF6` (purple - AI/copilot)

**Typography:**
- Font Family: `"Geist", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif`
- Heading 1: 32px, font-weight 600, letter-spacing -0.02em
- Heading 2: 24px, font-weight 600, letter-spacing -0.01em
- Heading 3: 18px, font-weight 500
- Body: 14px, font-weight 400, line-height 1.6
- Caption: 12px, font-weight 400
- Monospace: `"Geist Mono", "SF Mono", monospace`

**Spacing System:**
- Base unit: 4px
- xs: 4px, sm: 8px, md: 16px, lg: 24px, xl: 32px, 2xl: 48px

**Visual Effects:**
- Card shadows: `0 4px 24px rgba(0, 0, 0, 0.4)`
- Hover transitions: 150ms ease-out
- Border radius: 8px (cards), 6px (buttons), 4px (inputs)
- Glass effect on modals: `backdrop-filter: blur(12px)`

### Components

**Navigation Sidebar:**
- Logo/Brand mark at top
- Nav items: Chat, Actions, History, Integrations, Settings
- Active state: left border accent, background highlight
- Connection status indicators (green/red dots)

**Chat Interface (Copilot):**
- Message bubbles: AI (purple left), User (dark gray right)
- Input: Fixed bottom, textarea with Cmd+Enter to send
- Typing indicator: Animated dots
- Action提案卡片: Elevated cards with approve/reject buttons

**Action Proposal Card:**
- Title with icon
- Description of action
- Tool target (e.g., "Send email via Gmail")
- Parameters preview (collapsible JSON)
- Actions: Approve (green), Reject (red), Modify (gray)

**Execution Log Entry:**
- Timestamp, status badge
- Action summary
- Expandable details
- Retry button on failure

**Integration Card:**
- App icon (Gmail, Calendar, Notion, etc.)
- Connection status
- Last sync time
- Connect/Disconnect button

---

## 3. Functionality Specification

### Core Features

**1. AI Copilot Chat Interface**
- Natural language input field
- Real-time message streaming
- Context-aware suggestions
- Conversation history persistence
- Ability to cancel in-progress requests

**2. Action Proposal System**
- AI analyzes user request
- Generates structured action plan
- Displays preview before execution
- Shows confidence score
- Allows modification before approval

**3. Human Approval Workflow**
- Pending actions queue
- One-click approve/reject
- Batch approval option
- Notification on new proposals
- Auto-timeout configuration (optional)

**4. Tool Integrations**
- Gmail: Send emails, read inbox, manage labels
- Google Calendar: Create events, read schedules
- Notion: Create pages, update databases
- (Extensible for more tools)

**5. Execution Logs & Audit Trail**
- Chronological action history
- Status tracking (pending, approved, rejected, executed, failed)
- Detailed execution logs
- Export capabilities

**6. Workspace Management**
- Multiple workspaces support
- Team collaboration (future)
- Integration management per workspace

### User Interactions & Flows

**Primary Flow:**
1. User enters request in chat
2. AI processes and proposes action(s)
3. User reviews and approves
4. System executes action
5. Result logged and displayed

**Approval Flow:**
1. New proposal appears in queue
2. User clicks to expand details
3. Approve → Execute → Show result
4. Or Reject → Log as rejected

### Data Handling

- **Messages:** Stored in database, paginated
- **Actions:** State machine (proposed → approved/rejected → executing → completed/failed)
- **Integrations:** OAuth tokens encrypted, stored per user
- **Logs:** Append-only, retained based on plan

### Edge Cases

- Network failure during execution → Retry with exponential backoff
- Integration token expired → Prompt re-authentication
- Conflicting actions → Warn user before approval
- AI unsure → Ask clarifying questions before proposing

---

## 4. Technical Architecture

### Stack
- **Frontend:** Next.js 14 (App Router), React 18, TypeScript
- **Styling:** CSS Modules + CSS Variables
- **Database:** PostgreSQL with Prisma ORM
- **Authentication:** Clerk (as configured)
- **AI:** Anthropic Claude API
- **State:** React Context + SWR for data fetching

### Project Structure
```
/app
  /api          - API routes
  /(auth)       - Auth pages (sign-in, sign-up)
  /(dashboard) - Protected dashboard routes
    /chat       - Chat interface
    /actions    - Actions queue
    /history    - Execution history
    /integrations - Integration management
    /settings   - User settings
/components
  /ui           - Base UI components
  /chat         - Chat-specific components
  /actions      - Action proposal components
  /integrations - Integration cards
/lib
  /db           - Database client
  /ai           - AI utilities
  /integrations - Integration clients
/prisma
  schema.prisma - Database schema
```

---

## 5. Acceptance Criteria

### Visual Checkpoints
- [ ] Dark theme renders correctly with specified colors
- [ ] Sidebar navigation highlights active route
- [ ] Chat messages display with correct alignment and colors
- [ ] Action proposal cards are clearly distinguished
- [ ] Status badges show correct colors (pending=amber, approved=green, rejected=red)
- [ ] Responsive layout works at all breakpoints

### Functional Checkpoints
- [ ] User can send message and receive AI response
- [ ] Action proposals appear after AI processes request
- [ ] Approve button triggers execution
- [ ] Reject button logs rejection
- [ ] Execution history displays chronologically
- [ ] Integration cards show connection status

### Performance
- [ ] Initial page load < 2 seconds
- [ ] Chat messages appear within 500ms of AI response
- [ ] Smooth 60fps animations

---

## 6. Pages

1. **Sign In/Sign Up** - Clerk authentication
2. **Dashboard** - Overview with recent activity
3. **Chat** - Main copilot interface
4. **Actions** - Pending approvals queue
5. **History** - Past executions
6. **Integrations** - Connected apps management
7. **Settings** - User preferences