# Sikika Documentation Index

This is the master navigation reference. Every module and feature is listed below with direct links to the documentation that covers it.

---

## By Module / Feature Area

### Authentication & Sessions
| What you need | Where to find it |
|---------------|-----------------|
| Signup flow (3-step OTP-first) | [authentication.md → Sign-Up Flow](authentication.md#sign-up-flow) |
| Sign-in flow (password + mandatory 2FA) | [authentication.md → Sign-In Flow](authentication.md#sign-in-flow-password--mandatory-2fa) |
| Forgot password / reset | [authentication.md → Forgot Password Flow](authentication.md#forgot-password-flow) |
| Forced first-login reset (staff accounts) | [authentication.md → Forced Password Reset](authentication.md#forced-password-reset-staff-accounts) |
| Logout & session clearing / Quick Exit | [authentication.md → Logout and Session Clearing](authentication.md#logout-and-session-clearing) |
| JWT — payload, lifetime, storage | [authentication.md → JWT Tokens](authentication.md#jwt-tokens) |
| OTP lifecycle, lockout, bcrypt hashing | [authentication.md → Security Rules](authentication.md#security-rules) |
| Africa's Talking SMS / sandbox vs live | [authentication.md → Africa's Talking SMS Integration](authentication.md#africastalking-sms-integration) |
| Auth API endpoints | [api-reference.md → Auth](api-reference.md#auth-apiauth) |
| Signup ticket term | [glossary.md → Signup ticket](glossary.md) |
| authStage values explained | [authentication.md → Auth Stages and Intents](authentication.md#auth-stages-and-intents) |

---

### Direct Chat (E2EE)
| What you need | Where to find it |
|---------------|-----------------|
| Channel provisioning — how channels are created | [direct-chat.md → Channel Provisioning](direct-chat.md#channel-provisioning) |
| Channel status lifecycle (active → archived → deleted → restore) | [direct-chat.md → Channel Status Lifecycle](direct-chat.md#channel-status-lifecycle) |
| Trash view — restoring deleted channels | [direct-chat.md → Trash View](direct-chat.md#trash-view) |
| Staff visibility rules (staff never see deleted channels) | [direct-chat.md → Access Control Rules](direct-chat.md#access-control-rules) |
| Archive / Restore / Delete action menu in the UI | [direct-chat.md → Archive Restore Delete Action Menu](direct-chat.md#archiverestoredelete-action-menu) |
| End-to-end encryption design | [e2ee.md](e2ee.md) |
| ECDH key exchange, AES-GCM encryption, threat model | [e2ee.md → How it works conceptually](e2ee.md#how-it-works-conceptually) |
| Private key storage in IndexedDB (non-extractable) | [e2ee.md → Implementation](e2ee.md#implementation) |
| XSS / IndexedDB threat note | [e2ee.md → Threat model](e2ee.md#threat-model) |
| Pending message queue (composing before counterpart has a key) | [e2ee.md → Pending-message queue](e2ee.md#pending-message-queue-composing-before-the-counterparts-key-exists) |
| `chatKey:available` socket event | [sockets.md → chatSocket Events](sockets.md#chatsocket-events) |
| Presence indicators (online / offline / busy) | [sockets.md → Presence System](sockets.md#presence-system) |
| Sent / Delivered / Seen ticks | [sockets.md → Delivery Model](sockets.md#delivery-model) |
| Direct chat REST endpoints | [api-reference.md → Chat](api-reference.md#chat-apichat) |
| DirectChatChannel and DirectChatMessage models | [data-model.md → Direct Chat](data-model.md) |

---

### Community Chat & Rooms
| What you need | Where to find it |
|---------------|-----------------|
| Room creation and join gate | [community-moderation.md → Community Room Lifecycle](community-moderation.md#community-room-lifecycle) |
| Survivor nickname-only identity in rooms | [community-moderation.md → Survivor Identity](community-moderation.md#survivor-identity) |
| Real-time room messaging (socket events) | [sockets.md → communitySocket Events](sockets.md#communitysocket-events) |
| Community REST endpoints | [api-reference.md → Community](api-reference.md#community-apicommunity) |
| CommunityRoom and CommunityMessage models | [data-model.md](data-model.md) |

---

### Community Moderation
| What you need | Where to find it |
|---------------|-----------------|
| Harmful content report flow (submission → review) | [community-moderation.md → HarmfulContentReport Flow](community-moderation.md#harmfulcontentreport-flow) |
| Moderation actions: warn, delete message, ban user | [community-moderation.md → Moderation Actions](community-moderation.md#moderation-actions) |
| `ban_user` — what it does atomically | [community-moderation.md → ban_user Action](community-moderation.md#ban_user-action) |
| `canModerate` check (NGO_ADMIN + MODERATOR both qualify) | [community-moderation.md → canModerate Check](community-moderation.md#canmoderate-check) |
| Dual audit trail (ModerationActionLog + AuditLog) | [community-moderation.md → Dual Audit Trail](community-moderation.md#dual-audit-trail) |
| Moderation Desk UI tabs (Reports Queue / Banned Users) | [community-moderation.md → Moderation Desk UI](community-moderation.md#moderation-desk-ui) |
| Moderator workload score increment | [community-moderation.md → Moderator Workload Score](community-moderation.md#moderator-workload-score) |
| Cascade reassignment when a counsellor is banned | [admin-dashboard.md → cascadeReassignOnStaffBan](admin-dashboard.md#cascadereassignonstaffban) |
| BANNABLE_ROLES list and why | [rbac.md → BANNABLE_ROLES](rbac.md#bannable_roles) |

---

### Incident Reporting
| What you need | Where to find it |
|---------------|-----------------|
| 7-state status machine and transition graph | [reporting.md → Report Status State Machine](reporting.md#report-status-state-machine) |
| Role-scoped allowed transitions | [reporting.md → Role-Scoped Transitions](reporting.md#role-scoped-transitions) |
| Survivor consent requirement for legal escalation | [reporting.md → survivorConsent Flag](reporting.md#survivorconsent-flag) |
| Evidence file upload and Cloudinary private delivery | [reporting.md → Evidence Files](reporting.md#evidence-files) |
| Unauthenticated reporter emergency intercept | [reporting.md → Unauthenticated Reporter Flow](reporting.md#unauthenticated-reporter-flow) |
| Role-specific views (Survivor / Staff / Legal Counsel) | [reporting.md → Role-Specific Views](reporting.md#role-specific-views) |
| Deep-link highlight (`?reportId=`) | [reporting.md → Deep-Link Highlight](reporting.md#deep-link-highlight) |
| Legal case auto-creation on status transitions | [reporting.md → Legal Case Auto-Creation](reporting.md#legal-case-auto-creation) |
| Report REST endpoints | [api-reference.md → Reports](api-reference.md#reports-apireports) |
| IncidentReport model | [data-model.md](data-model.md) |

---

### Legal Cases
| What you need | Where to find it |
|---------------|-----------------|
| When a legal case is auto-created | [legal-cases.md → Auto-Creation Triggers](legal-cases.md#auto-creation-triggers) |
| Structured authoring fields (4 fields) | [legal-cases.md → Structured Authoring Fields](legal-cases.md#structured-authoring-fields) |
| Case status lifecycle | [legal-cases.md → Case Status Lifecycle](legal-cases.md#case-status-lifecycle) |
| PDF generation (pdfkit) and Cloudinary private upload | [legal-cases.md → PDF Generation](legal-cases.md#pdf-generation) |
| Document retrieval via backend proxy (blob streaming) | [legal-cases.md → Document Retrieval](legal-cases.md#document-retrieval) |
| Legal Counsel drafting panel in the UI | [legal-cases.md → Frontend Drafting Panel](legal-cases.md#frontend-drafting-panel) |
| Access control (LEGAL_COUNSEL only) | [legal-cases.md → Access Control](legal-cases.md#access-control) |
| Legal case REST endpoints | [api-reference.md → Legal Cases](api-reference.md#legal-cases-apilegal-cases) |
| LegalCaseFile model | [data-model.md](data-model.md) |

---

### Resource Library
| What you need | Where to find it |
|---------------|-----------------|
| Resource CRUD, file upload, access tracking | [resource-management.md](resource-management.md) |
| Fallback resources when backend is unreachable | [resource-management.md → Fallback Data](resource-management.md) |
| Cloudinary delivery for support resources | [cloudinary.md](cloudinary.md) |
| Resource REST endpoints | [api-reference.md → Resources](api-reference.md#resources-apiresources) |
| SupportResource model | [data-model.md](data-model.md) |

---

### USSD
| What you need | Where to find it |
|---------------|-----------------|
| USSD menu tree | [ussd.md → Menu Tree](ussd.md#menu-tree) |
| Africa's Talking integration / CON vs END responses | [ussd.md → How USSD Works with Africa's Talking](ussd.md#how-ussd-works-with-africas-talking) |
| Local dev setup with ngrok | [ussd.md → Local Development Setup](ussd.md#local-development-setup) |
| Session timeout and retry behaviour | [ussd.md → Session Timeout and Retry Behaviour](ussd.md#session-timeout-and-retry-behaviour) |
| Sandbox-to-live migration | [ussd.md → Sandbox-to-Live Migration](ussd.md#sandbox-to-live-migration) |
| Auto-assignment of callback requests | [ussd.md → Auto-Assignment of Callbacks](ussd.md#auto-assignment-of-callbacks) |
| USSD REST endpoints | [api-reference.md → USSD](api-reference.md#ussd-apiussd) |
| UssdCallbackRequest model | [data-model.md](data-model.md) |

---

### In-App Notifications
| What you need | Where to find it |
|---------------|-----------------|
| Which events trigger notifications | [notifications.md → Trigger Events](notifications.md#trigger-events) |
| `notificationService.js` as the single write path | [notifications.md → Architecture Overview](notifications.md#architecture-overview) |
| `notificationDismissedStatus` vs `notificationReadStatus` | [notifications.md → Dismiss vs Read](notifications.md#notificationdismissedstatus-vs-notificationreadstatus) |
| Real-time push via `notification:new` socket event | [notifications.md → Real-Time Delivery](notifications.md#real-time-delivery) |
| 30-second polling fallback | [notifications.md → 30-Second Polling Fallback](notifications.md#30-second-polling-fallback) |
| NotificationBell component and deep-link routing | [notifications.md → NotificationBell Component](notifications.md#notificationbell-component) |
| Notification REST endpoints | [api-reference.md → Notifications](api-reference.md#notifications-apinotifications) |
| InAppNotification model | [data-model.md](data-model.md) |

---

### NGO Admin Dashboard
| What you need | Where to find it |
|---------------|-----------------|
| All dashboard sections overview | [admin-dashboard.md → Dashboard Sections](admin-dashboard.md#dashboard-sections) |
| Auto-assignment algorithm (least-loaded-staff) | [admin-dashboard.md → Auto-Assignment Algorithm](admin-dashboard.md#auto-assignment-algorithm) |
| Cascade reassignment on staff ban | [admin-dashboard.md → cascadeReassignOnStaffBan](admin-dashboard.md#cascadereassignonstaffban) |
| Reassignment suggestion "Recommended" badge | [admin-dashboard.md → Reassignment Suggestion Flow](admin-dashboard.md#reassignment-suggestion-flow) |
| Staff onboarding and first-login reset | [admin-dashboard.md → Staff Onboarding](admin-dashboard.md#staff-onboarding) |
| SUSPENDED vs BANNED distinction | [admin-dashboard.md → SUSPENDED vs BANNED](admin-dashboard.md#suspended-vs-banned) |
| Maintenance mode — storage, caching, NGO bypass | [admin-dashboard.md → Maintenance Mode](admin-dashboard.md#maintenance-mode) |
| USSD callback queue in the dashboard | [admin-dashboard.md → USSD Callback Queue](admin-dashboard.md#ussd-callback-queue) |
| Admin REST endpoints | [api-reference.md → Admin](api-reference.md#admin-apiadmin) |

---

### Roles & Permissions
| What you need | Where to find it |
|---------------|-----------------|
| The 6 roles and what each one can do | [rbac.md → The 6 Roles](rbac.md#the-6-roles) |
| Feature-permission matrix | [rbac.md → Feature-Permission Matrix](rbac.md#feature-permission-matrix) |
| Auth middleware chain (JWT + role + accountStatus) | [rbac.md → Auth Middleware Chain](rbac.md#auth-middleware-chain) |
| BANNABLE_ROLES and why some roles are excluded | [rbac.md → BANNABLE_ROLES](rbac.md#bannable_roles) |
| SUSPENDED vs BANNED | [rbac.md → SUSPENDED vs BANNED](rbac.md#suspended-vs-banned) |
| Moderator's narrow role scope | [rbac.md → Moderator Scope](rbac.md#moderator-scope) |
| Frontend role-based route maps | [rbac.md → Frontend Route Maps](rbac.md#role-based-route-maps-in-the-frontend) |

---

### Real-time / Sockets
| What you need | Where to find it |
|---------------|-----------------|
| Socket.io namespace and JWT handshake | [sockets.md → Namespace Structure](sockets.md#namespace-structure-and-jwt-handshake) |
| Room naming conventions | [sockets.md → Room Naming Conventions](sockets.md#room-naming-conventions) |
| All chatSocket events (with payload shapes) | [sockets.md → chatSocket Events](sockets.md#chatsocket-events) |
| All communitySocket events | [sockets.md → communitySocket Events](sockets.md#communitysocket-events) |
| Presence system (presenceRegistry, BUSY override) | [sockets.md → Presence System](sockets.md#presence-system) |
| Delivery model (deliveredAt, seenAt, ticks) | [sockets.md → Delivery Model](sockets.md#delivery-model) |
| Delivery catch-up on reconnect | [sockets.md → Delivery Catch-Up on Reconnect](sockets.md#delivery-catch-up-on-reconnect) |
| notificationSocket (client singleton) | [sockets.md → notificationSocket](sockets.md#notificationsocket) |

---

### File Storage (Cloudinary)
| What you need | Where to find it |
|---------------|-----------------|
| How all 3 asset types are stored and delivered | [cloudinary.md](cloudinary.md) |
| Backend proxy — why URLs never reach the browser | [cloudinary.md → Private Asset Delivery](cloudinary.md) |
| Evidence files (reports) | [cloudinary.md](cloudinary.md) · [reporting.md → Evidence Files](reporting.md#evidence-files) |
| Legal case PDFs | [legal-cases.md → Document Retrieval](legal-cases.md#document-retrieval) |
| Support resources | [resource-management.md](resource-management.md) |
| Cloudinary 503 fallback behaviour | [troubleshooting.md → Cloudinary Issues](troubleshooting.md#cloudinary-issues) |

---

### Data Models
| What you need | Where to find it |
|---------------|-----------------|
| Full ERD and model overview | [data-model.md](data-model.md) |
| Identity root pattern (UserAccount + profile tables) | [data-model.md → Identity Model](data-model.md#identity-model) |
| UUID primary key strategy | [data-model.md → Primary Key Strategy](data-model.md#primary-key-strategy) |
| Workload score system | [data-model.md → Workload Score System](data-model.md#workload-score-system) |
| Survivor assignment model | [data-model.md → Assignment Model](data-model.md#assignment-model) |
| Chat channel status lifecycle (model level) | [data-model.md → Chat Channel Status Lifecycle](data-model.md#chat-channel-status-lifecycle) |
| Report status state machine (model level) | [data-model.md → Report Status State Machine](data-model.md#report-status-state-machine) |
| Full association map | [data-model.md → Association Map](data-model.md#association-map) |

---

### Frontend Architecture
| What you need | Where to find it |
|---------------|-----------------|
| Custom SPA router (no React Router) | [frontend-architecture.md → Custom SPA Router](frontend-architecture.md#custom-spa-router) |
| Role-based route maps | [frontend-architecture.md → Role-Based Route Maps](frontend-architecture.md#role-based-route-maps) |
| Auth-gated routing (`/reports` exception) | [frontend-architecture.md → Auth-Gated Routing](frontend-architecture.md#auth-gated-routing) |
| sessionStorage session management | [frontend-architecture.md → Session Management](frontend-architecture.md#session-management) |
| No-shared-state policy (no Context / Zustand) | [frontend-architecture.md → No Shared State Policy](frontend-architecture.md#no-shared-state-policy) |
| Maintenance mode 15s polling | [frontend-architecture.md → Maintenance Mode Polling](frontend-architecture.md#maintenance-mode-polling) |
| E2EE bootstrap on every auth load | [frontend-architecture.md → E2EE Bootstrap](frontend-architecture.md#e2ee-bootstrap) |
| Quick Exit button behavior | [frontend-architecture.md → Quick Exit Button](frontend-architecture.md#quick-exit-button) |
| CSS custom property token system / single light theme | [frontend-architecture.md → CSS Token System](frontend-architecture.md#css-custom-property-token-system) |
| Code splitting (lazy pages) | [frontend-architecture.md → Code Splitting](frontend-architecture.md#code-splitting) |
| Deep-link routing via query params | [frontend-architecture.md → Routing Deep-Links](frontend-architecture.md#routing-deep-links) |

---

### Server Boot Process
| What you need | Where to find it |
|---------------|-----------------|
| Full 10-step boot sequence | [server-bootup.md](server-bootup.md) |
| `ensureSchemaCompatibility` — ENUM DDL guards | [server-bootup.md → ensureSchemaCompatibility](server-bootup.md#step-8--ensureschemacombatibility) |
| Maintenance mode load on boot | [server-bootup.md → loadMaintenanceStateFromDb](server-bootup.md#step-9--loadmaintenancestatefromdb) |
| Environment variables that affect boot | [server-bootup.md → Environment Variables](server-bootup.md#environment-variables-that-affect-boot) |
| Graceful shutdown procedure | [server-bootup.md → Graceful Shutdown](server-bootup.md#graceful-shutdown) |
| Connection pool tuning | [server-bootup.md → Connection Pool Tuning](server-bootup.md#connection-pool-tuning) |

---

### Deployment
| What you need | Where to find it |
|---------------|-----------------|
| System requirements (Node, MySQL, npm versions) | [deployment.md → System Requirements](deployment.md#system-requirements) |
| Environment variables checklist | [deployment.md → Environment Variables](deployment.md#environment-variables-checklist) |
| PM2 process manager setup | [deployment.md → PM2](deployment.md#pm2-process-manager) |
| Nginx config with WebSocket upgrade headers | [deployment.md → Nginx](deployment.md#nginx-reverse-proxy) |
| SSL via certbot | [deployment.md → SSL](deployment.md#ssltls-via-certbot) |
| Africa's Talking live shortcode setup | [deployment.md → Africa's Talking](deployment.md#africastalking-configuration) |
| Cloudinary production setup | [deployment.md → Cloudinary](deployment.md#cloudinary-production-setup) |
| Pre-launch checklist | [deployment.md → Pre-Launch Checklist](deployment.md#pre-launch-checklist) |

---

### Troubleshooting
| Symptom | Where to find it |
|---------|-----------------|
| OTP not arriving / lockout / JWT expiry | [troubleshooting.md → Authentication Failures](troubleshooting.md#authentication-failures) |
| Pending messages stuck / key not found | [troubleshooting.md → Chat & E2EE Issues](troubleshooting.md#chat--e2ee-issues) |
| Socket drops / banned mid-session eviction | [troubleshooting.md → Socket Connection Issues](troubleshooting.md#socket-connection-issues) |
| ENUM truncation / boot failure | [troubleshooting.md → Schema / Boot Failures](troubleshooting.md#schema--boot-failures) |
| Cloudinary 503 / streaming 404 | [troubleshooting.md → Cloudinary Issues](troubleshooting.md#cloudinary-issues) |
| USSD callback not appearing / session timeout | [troubleshooting.md → USSD Issues](troubleshooting.md#ussd-issues) |
| Notification not received / badge not updating | [troubleshooting.md → Notification Delivery Failures](troubleshooting.md#notification-delivery-failures) |

---

### Contributing & Glossary
| What you need | Where to find it |
|---------------|-----------------|
| JSDoc requirement with examples | [CONTRIBUTING.md → JSDoc Requirement](../CONTRIBUTING.md#jsdoc-requirement) |
| PR checklist | [CONTRIBUTING.md → PR Checklist](../CONTRIBUTING.md#pr-checklist) |
| Schema change rules (no manual ALTER TABLE) | [CONTRIBUTING.md → Schema Changes](../CONTRIBUTING.md#schema-changes) |
| Domain term definitions | [glossary.md](glossary.md) |
| Full REST API reference | [api-reference.md](api-reference.md) |
