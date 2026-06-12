# Pending Roadmap Items Status

This file tracks requested roadmap features that are either incomplete or pending.

Status legend:
- Done: implemented end-to-end in backend and frontend flows.
- Partial: implemented in some layers but missing full user workflow or policy coverage.
- Not Done: not implemented yet as a usable feature.

## 1) USSD Interface and Africa's Talking Integration
Status: Partial

What exists now:
- Data model exists for callback requests in backend models.
- Seeder includes sample USSD callback request data.
- Africa's Talking wiring exists for OTP SMS in authentication flow.

What is still missing:
- Live USSD endpoint/controller workflow.
- Menu flow for callback request vs hotline option.
- USSD session response handling and persistence path that creates callback records from actual USSD traffic.
- Explicit hotline return flow in USSD session.

## 2) Legal Case Escalation Workflow
Status: Partial

What exists now:
- Legal case model and report-to-legal-case linkage exist.
- Escalation guard requires legal counsel role and survivor consent.
- Legal case lifecycle fields and generatedDocumentPath field exist.
- Reporting UI already surfaces legal-case details in report views.

What is still missing:
- Dedicated legal counsel case drafting workflow/UI for structured case document authoring.
- Explicit manual export/handover workflow implementation.

## 3) Discreet In-App Notification System
Status: Partial

What exists now:
- Persistent notification entity exists with read/unread storage field.
- Notifications are written in chat/report flows.
- Discreet wording pattern is used in stored notification text.

What is still missing:
- Full notification center UX for users.
- Notification API set for list/read/dismiss actions.
- Dismissible-state implementation (separate from read state).

## 4) Unregistered User Emergency Flow
Status: Done

What exists now:
- Unauthenticated users navigating to /reports see an intercept screen instead of a silent redirect.
- Intercept screen offers two explicit choices: Create Account or View Emergency Contacts.
- Emergency contacts modal shows Police (999/112), Childline Kenya (116), National GBV Hotline (1195).
- Modal closes on Escape, backdrop click, or Close button.
- Returning users have a Sign In link below the primary actions.
- /reports removed from App.jsx protected paths so the intercept renders rather than bouncing to /join.

## 5) Specific Chat and Moderation Actions
Status: Partial

5A) Survivor archive/delete direct chats
Status: Not Done

What exists now:
- Direct chat channel model supports status values including archived/deleted.

What is still missing:
- API endpoints and frontend actions for survivor archive/delete operations.

5B) Moderation warning action
Status: Done

What exists now:
- Moderation review supports issue_warning action.
- Warning action is persisted in moderation action logs.
- NGO admin dashboard exposes Issue Warning control.

## 6) Staff Presence Indicators
Status: Partial

What exists now:
- availabilityStatus exists in counsellor/legal counsel profiles.
- NGO admin dashboards and profile workflows use availability values.
- Message persistence supports asynchronous read-later behavior.

What is still missing:
- Clear end-user online/offline presence indicator in chat surfaces for assigned staff.
- Explicit offline async UX language and delivery-state handling when staff return.

## 7) Specific NGO Analytics
Status: Partial

7A) Average response time
Status: Not Done

What is still missing:
- Average staff response-time calculation and dashboard visualization.

7B) Workload visualizations by counsellor/legal counsel
Status: Done

What exists now:
- NGO dashboard provides staffing workload datasets.
- Frontend visualizes assigned survivor workload for counsellors and legal counsel.

## 8) User Banning Workflow
Status: Partial

What exists now:
- Moderation supports `suspend_user` on approved harmful-content reports.
- Staff lifecycle controls support ACTIVE <-> SUSPENDED transitions for counsellor/legal counsel accounts.

What is still missing:
- Explicit BAN/BANNED lifecycle state (separate from temporary suspension).
- End-to-end NGO admin workflow to ban and unban target users with policy guardrails.
- Ban duration/reason tracking and audit metadata specific to ban events.
- UI visibility for banned status and ban history in admin/user management surfaces.

## Suggested next implementation order
1. Item 4 emergency intercept (high safety and UX value).
2. Item 1 USSD live flow (major requirement gap).
3. Item 7A response-time analytics.
4. Item 3 notification center API + UI.
5. Item 5A chat archive/delete controls.
6. Item 6 explicit presence indicator UX.
7. Item 8 user banning workflow.
8. Item 2 dedicated legal document drafting/export workflow.
