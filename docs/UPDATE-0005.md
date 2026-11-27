# Update 0005 — Role-based approvals, history, project assignments, UI/UX and performance

This update builds on the daily-timesheet / leave workflow (migrations 0003–0004). Nothing was rebuilt from scratch and no existing feature was removed. The one deliberate behaviour change is described under **Changes to earlier behaviour** below.

---

## 1. Modified and new files

**Database**
| File | Status |
|---|---|
| `supabase/migrations/0005_role_routing_history_projects.sql` | **new** — routing, immutable history, project members, RPCs, RLS, indexes |
| `supabase/tests/*` (`run_local_tests.sh`, `00_…`–`40_role_tests.sql`) | **new** — 132-check permission and regression suite (local PostgreSQL only) |

**Shared code**
| File | Status |
|---|---|
| `src/lib/auth.ts` | changed — faster context (no more loading every profile on each request), `getApprovalCounts()` cached per request |
| `src/lib/nav.ts` | changed — grouped menu, Approval History item, People icon |
| `src/lib/types.ts` | changed — `ApprovalRoute`, `ApprovalStatus`, `ApprovalRecord`, `ProjectMember`, status labels, `routeForRole` |
| `src/lib/dates.ts` | changed — `fmtDay()` |
| `src/lib/approval-records.ts` | **new** — validated history filters + `approval_records` RPC wrapper |
| `src/lib/routing.ts` | **new** — who will approve my requests (display only) |
| `src/components/ui.tsx` | changed — design-system components: status badges with icons, Stat, Card, Tabs, Pager, Skeleton, KV, Person, Tag |
| `src/components/AppShell.tsx` | changed — grouped navigation, skip link, Escape / outside-click, correct active item |
| `src/components/icons.ts` | changed — new icons |
| `src/components/ConfirmButton.tsx` | **new** — accessible confirmation dialog for important actions |
| `src/components/SubmitButton.tsx` | **new** — disables while the Server Action runs (no double submits) |
| `src/components/ApprovalTable.tsx` | **new** — approval records table with sortable headers |
| `src/app/globals.css` | rewritten — design tokens, typography, components, responsive, accessibility |

**Pages**
| File | Status |
|---|---|
| `src/app/(app)/layout.tsx` | changed — one RPC for the approvals badge |
| `src/app/(app)/loading.tsx`, `error.tsx` | **new** — loading skeleton, friendly error state |
| `src/app/(app)/page.tsx` + `_dashboard/Personal.tsx`, `ManagerSection.tsx`, `PmSection.tsx`, `OrgSections.tsx` | rewritten / **new** — role dashboards, streamed with Suspense |
| `src/app/(app)/approvals/page.tsx`, `actions.ts`, `DecisionControls.tsx` | changed / **new** — queue of what you can decide, route tags, confirmed decisions |
| `src/app/(app)/approvals/history/page.tsx` | **new** — manager / HR approval history with filters, search, sort, pagination |
| `src/app/(app)/timesheet/page.tsx`, `actions.ts`, `TimesheetHistory.tsx` | changed / **new** — Today / History tabs, assigned projects only, server-side project check |
| `src/app/(app)/leave/page.tsx`, `LeaveForm.tsx`, `actions.ts`, `LeaveHistory.tsx` | changed / **new** — Overview / History tabs, approver shown, blocked state |
| `src/app/(app)/projects/page.tsx`, `actions.ts`, `[id]/page.tsx` | changed / **new** — team sizes, project team management, assignment history |
| `src/app/(app)/people/page.tsx` | changed — routing explanation, warning for people without a line manager |
| `src/app/(app)/team/page.tsx`, `notifications/page.tsx`, `settings/page.tsx`, `src/app/login/page.tsx` | changed — explicit columns, confirm / pending buttons |
| `README.md`, `docs/UPDATE-0005.md` | changed / **new** |

---

## 2. Role-based approval workflow

The route is decided **inside the database** from the requester's profile at the moment they submit (`public._approval_route`), stored on the request (`approval_route`), and never taken from the browser — the column is not writable by the app.

| Requester's role (from `profiles.role`) | Timesheets and leave go to | If nobody can approve |
|---|---|---|
| Employee, HR, Administrator | their **active line manager** | submission refused: "You do not have an active line manager…" |
| Manager, Project Manager, Leadership | **HR** (every active HR user is notified) | submission refused: "There is no active HR approver…" |

- **Nobody can decide their own request** (checked in `decide_leave`, `decide_timesheet_day` and `can_decide_request`).
- A manager's own request is never routed to themselves or to their own line manager. Example: Leadership user Lena manages Manager Mona. Mona's requests go to HR; Lena can see them in her team history (read-only) but cannot decide them.
- **HR is never a fallback** for normal employees and cannot decide employees' requests (unless HR is that employee's line manager).
- Decisions: approve, reject or request changes, with a comment (required for reject / changes). The requester is notified with the approver's name ("Hana HR (HR) approved your annual leave…").
- One permission function, `can_decide_request(owner, route)`, is used by both workflows, the approval queue, the badge counts and the history.

**Changes to earlier behaviour**
1. HR no longer reviews ordinary employees' timesheets. Earlier versions let HR review any timesheet and sent timesheets of people without a line manager to HR. Both now follow the line-manager rule above.
2. Employees without an active line manager can no longer submit leave. Migration 0004 sent their leave to administrators; the new requirement is to block submission instead. Drafts can still be saved.
3. Requests that were already waiting when you run 0005 are re-routed: pending items from managers / PMs / leadership move to HR, and every HR user gets a one-time notification. Older pending items from people with no line manager stay decidable by an administrator, so nothing gets stuck.

---

## 3. Personal and organisation-wide history

**Personal (every role):**
- **My Timesheet → History** shows each day's work date, project codes, tasks, total hours, submission time (plus resubmission), status, approver, comment and decision time, with a full timeline per day. Filter by status and date range; 20 per page.
- **My Leave → History** shows type, first and last day, days, reason, submission date, status, approver name, decision date/time, comment and timeline. Filter by status, type and year; 20 per page.
- Both query `user_id = me`, and row-level security enforces the same rule.

**Approval History (`/approvals/history`):**
- **Line managers** see their direct reports' records, including requests routed to HR (read-only), plus any decision they made themselves.
- **HR** sees every employee's records organisation-wide.
- **Administrators** see legacy requests from people with no line manager.
- Nobody's own requests appear here.
- Filters: employee (name or email), request type, status, role, department, project, approver, date range. Sortable by employee, request date, submission date and decision date. 25 per page with a total count.
- The scope is enforced in `public.approval_records()` in the database, not in the page.

**Immutable history:** every submit, resubmit, approve, reject, request-changes and cancel writes a row to `leave_history` or `timesheet_reviews`. Each row holds: request ID, owner, approver (`actor_id`) and their role at the time, previous status, new status, decision (`action`), comment and timestamp. A trigger blocks UPDATE and DELETE for any logged-in user, even through database functions. The app has no insert/update/delete privileges on these tables. A leave draft that was ever submitted can no longer be deleted (cancel it instead), so its history is never cascaded away.

---

## 4. Project employee assignment

- New table **`project_members`** with `id, project_id, employee_id, assigned_by, assigned_at, unassigned_by, unassigned_at, active, created_at, updated_at`.
  - A partial unique index allows one *active* assignment per person per project.
  - Unassigning sets `active = false` plus the date and the person who did it. Re-assigning creates a new row, so the full history is kept.
- **Who can change teams** (`can_manage_project`): project managers on projects they manage; HR and administrators on any project. Leadership is read-only.
- `assign_project_member` refuses:
  - duplicates
  - inactive employees
  - archived projects
  - unauthorised users
- `unassign_project_member` refuses unauthorised users and people who are not currently assigned.
- Both notify the employee and write to the audit log.
- **Projects page:** PMs see their own projects; HR, leadership and admins see all. Each row shows the PM, team size, effort and deadline.
- **Project page (`/projects/[id]`):**
  - stats
  - current team with assignment date, who assigned them, and hours this week
  - **Assign employees** panel with search, department and role filters, listing only active people not yet on the team
  - **Unassign** behind a confirmation dialog
  - full **assignment history**
- **Timesheets:**
  - The project picker uses `my_loggable_projects()`: active projects you are assigned to, plus projects you manage as PM.
  - The Server Action re-checks the project, and the database trigger enforces it again whenever an entry is created or moved to another project.
  - Existing entries stay readable and editable (within the usual time rules) after unassignment. No historical data is changed.
- **Back-fill:** the migration assigns everyone who has already logged time on an active project to that project, so nobody loses access to work in progress. **After migrating, project managers should assign anyone else who works on their projects.**

---

## 5. Database schema changes (migration 0005)

| Object | Change |
|---|---|
| `leave_requests` | + `approval_route`, `submitted_at`, `last_submitted_at` (set by trigger, back-filled) |
| `daily_timesheets` | + `approval_route` (set on submit, back-filled) |
| `leave_history` | + `owner_id`, `from_status`, `to_status`, `actor_role` (back-filled where derivable) |
| `timesheet_reviews` | + `timesheet_id`, `from_status`, `to_status`, `actor_role` (back-filled) |
| `project_members` | **new table** (see section 4) |
| Functions (new) | `_approval_route`, `_route_approvers`, `_require_approver`, `_notify_route`, `_log_leave`, `_log_timesheet`, `_history_immutable`, `_can_log_to_project` (internal); `can_decide_request`, `can_manage_project`, `my_loggable_projects`, `assign_project_member`, `unassign_project_member`, `approval_records`, `approval_counts`, `org_overview` (callable by logged-in users) |
| Functions (replaced) | `leave_before_write`, `leave_after_write`, `decide_leave`, `cancel_leave`, `submit_timesheet_day`, `decide_timesheet_day`, `time_entry_daily_rules`, `_notify_approvers` (HR fallback removed), `can_decide_leave` |
| Triggers | `leave_history_immutable`, `timesheet_reviews_immutable` |
| Indexes | partial indexes for pending queues, submission/decision dates, decided-by, `time_entries(user_id, work_date)`, `time_entries(status, work_date)`, history lookups, `profiles(role)` and `profiles(department)` for active users, `projects(pm_id)`, `project_members` |

## 6. New SQL migration file

`supabase/migrations/0005_role_routing_history_projects.sql`:
- runs in a single transaction
- uses `CREATE OR REPLACE` / `IF NOT EXISTS` throughout
- drops no table and deletes no business row
- can safely be run again (verified)

## 7. Updated RLS and privileges

| Table | Read | Write |
|---|---|---|
| `project_members` | own rows; the project's PM; HR, admin, leadership | none directly — only `assign_project_member` / `unassign_project_member` |
| `leave_history`, `timesheet_reviews` | unchanged (own, line manager, HR/leadership) + admin for no-manager legacy rows | **no insert/update/delete** for the app; trigger blocks changes |
| `daily_timesheets`, `time_entries` | unchanged + admin read for no-manager legacy rows | unchanged; project membership enforced by trigger |
| `leave_requests` | unchanged | `approval_route` / `submitted_at` not client-writable; delete only never-submitted drafts |

All decision and assignment functions are `SECURITY DEFINER`. Each one checks the caller via `auth.uid()` and the profile stored in the database. Internal helpers are not executable by the API.

---

## 8. UI/UX improvements

**Colours and status**
- Design tokens in `globals.css`: indigo primary (`#3050d0`), slate sidebar, neutral greys.
- Status colours: green approved, red rejected, amber pending, blue information / changes requested, grey draft or inactive.
- Every badge has a text label plus a shape icon (✓ ✕ ⏳ ↺ –), so status is never shown by colour alone.
- Red is no longer the brand colour, so it means only "rejected / error".

**Typography**
- Inter. Page title 24 px, section headings 16 px, body 14 px, table headers 12 px uppercase.
- Nothing is smaller than 12 px. All colour pairs meet WCAG AA contrast.

**Layout and navigation**
- Grouped sidebar: My work / Team or Organisation / Administration. It can collapse, and becomes a drawer on mobile.
- Correct active item, breadcrumb, profile menu that closes on Escape or an outside click, and a skip-to-content link.

**Dashboards**

| Role | What it shows |
|---|---|
| Employee | today's status and hours, balances, pending actions, recent leave and timesheets, notifications |
| Manager | team overview, approvals to do, team time this week, availability, recent decisions |
| Project Manager | project progress, team sizes, workload, recent team changes |
| HR | headcount, HR approvals, approval statistics, departments, who is on leave, recent decisions |
| Leadership and admin | organisation totals, operational insights, projects by effort, people by department and role |

Organisation-wide sections use totals only, with no leave reasons.

**Components**
- Cards, stat tiles, tables with sortable headers, tabs, pager, filter bars.
- Forms with clear labels, required markers and inline errors.
- Empty states with icons, loading skeletons and a route-level error screen.
- **Confirmation dialogs** for approve, reject and request-changes; unassigning; archiving; deleting entries and drafts; cancelling leave; removing holidays.
- Accessibility: native `<dialog>` with focus handling, visible focus rings, `aria-current`, `aria-sort`, labelled progress bars, screen-reader-only labels, reduced-motion support and responsive layouts down to 360 px.

---

## 9. Performance improvements

- **Every page load:** the old context fetched *all profiles* on every request to work out approvers. It now runs a single head-only count, and the approvals badge is one RPC (`approval_counts`), shared per request with the dashboard via React `cache`.
- **Approval queue and history:** one RPC does filtering, scoping, sorting and pagination (`LIMIT/OFFSET` with a window count) in the database. Hours and project codes are added only for the rows on the page. Time entries for the queue are loaded in one batched query, with no N+1.
  - Measured on a local copy with 200 employees, 43,000 daily timesheets and 130,000 entries: HR history page about 54 ms, filtered by project and name about 100 ms, badge counts about 5 ms, org overview about 25 ms.
- **Personal history:** 20 rows per page with exact counts. Entries and timelines come from two batched queries per page.
- **Columns:** explicit column lists replace `select('*')` on the pages that changed.
- **Rendering:** dashboard sections are independent async Server Components streamed with `Suspense`. Client components are limited to the shell, forms, the confirm dialog, the submit button and the countdown.
- **Caching:** every page reads the user's cookies, so it is rendered per request and per user, and nothing user-specific is shared between users. Every mutation calls `revalidatePath('/', 'layout')`, so badges, dashboards, timesheets, leave balances and project pickers refresh straight away.

---

## 10. Test results by role

Run against PostgreSQL 16 with a Supabase-like `auth` schema. Every check runs as the real `authenticated` role with that user's JWT subject, through the same RLS policies and functions the app uses. Data from before 0005 (weekly entries, daily timesheets, pending leave, legacy no-manager requests) was loaded first, to prove the migration preserves and re-routes it.

| Role | Verified |
|---|---|
| Employee | requests go to line manager only (not HR); own history only; cannot read colleagues' leave, timesheets or history; cannot approve anyone; cannot set the route; cannot write history; cannot self-assign to projects; only assigned projects in picker; blocked without a line manager (draft still allowed) |
| Manager | own leave and timesheets go to HR (both HR users notified, own line manager not); cannot decide own; approves direct reports; sees a direct-report PM's HR-routed request read-only but cannot decide it; queue counts correct |
| Project Manager | own requests go to HR; logs time on own project; assigns and unassigns on own project; cannot assign twice, assign inactive people, assign to archived projects, or touch another PM's project; history preserved on unassign and reassign |
| Leadership | own requests go to HR; cannot decide a direct report manager's requests; read-only team history; org overview allowed; cannot change project teams |
| HR | decides manager, PM and leadership leave and timesheets (approve, reject, changes); cannot decide employees' requests; org-wide history with all filters, sorting and pagination; never sees own records there; own request needs a line manager; cannot delete history |
| Admin | decides legacy no-manager items only; cannot decide HR-route items; manages any project team; audit log |
| Regression | daily submission once per day; no past-dated entries; 30-minute edit window (edit allowed inside, refused after); approved timesheet locked; leave: no past dates, last day ≥ first day, reason required, balance check, approved leave cannot be cancelled; resubmission flow and history; notifications; audit log |
| Edge cases | no active HR user → manager submission refused with a clear message; immutable-history trigger blocks even owner-level updates for logged-in users |

**132 passed, 0 failed.** The full list is in the appendix. To re-run: `PGHOST=… PGPORT=… PGUSER=… ./supabase/tests/run_local_tests.sh` against a throwaway local PostgreSQL 15+.

## 11. TypeScript check

`npm run typecheck` could not be run in the build environment, because the npm packages (Next.js, React, Supabase) could not be downloaded there. As a substitute, the entire `src/` tree was compiled with TypeScript 6.0 and 7.0 in strict mode, with `noUnusedLocals`/`noUnusedParameters` on, using minimal type stubs for those three packages. **Result: 0 errors.** That check covers all application types, props of the app's own components, data shapes and Server Action signatures. It does not check JSX attributes against React's real DOM types or exact Supabase client generics. **Please run `npm install && npm run typecheck` once on your machine.**

## 12. Production build

`npm run build` could not be run there, for the same reason (no packages). Please run it locally after `npm install`. The code follows Next.js 16 conventions already used in the project: async `params` / `searchParams`, Server Actions in `'use server'` files exporting only async functions, client components marked `'use client'`, and no functions passed from server to client components.

## 13. Applying the migration

1. **Back up first:** Supabase → Database → Backups (or `pg_dump`).
2. Supabase → **SQL Editor → New query** → paste all of `supabase/migrations/0005_role_routing_history_projects.sql` → **Run**. It should say *Success*. Run 0003 and 0004 first if you have not already.
3. Run `supabase/tests/verify_0005_supabase.sql` in the SQL Editor (read-only). All rows should show `ok = true`. **Do not** run the other files in `supabase/tests/` in Supabase — they are local-only test files.
4. Check:
   - **People:** every employee, HR and admin user has an active line manager (the page warns about anyone missing one), and at least one active user has the HR role.
   - **Projects:** open each project and assign the team. People who had already logged time on a project were assigned automatically.
   - HR users have a notification if pending manager / PM / leadership requests were moved to them.
5. Deploy the updated app code.

## 14. Running and testing the app

```bash
npm install
npm run typecheck
npm run build
npm run dev          # http://localhost:3000
```

Manual test script (one account per role):
1. Employee with a line manager: log time on an assigned project, submit, and request leave. The line manager gets both, HR gets nothing.
2. Line manager: approve one, request changes on one (comment required, dialog shown), then check the employee's **History** tabs.
3. Manager, PM and leadership: submit your own timesheet and leave. They appear for HR, not for your own line manager.
4. HR: decide them, then open **Approval History** and try each filter, sort and page.
5. PM: open a project, assign an employee (they can now pick the project), unassign them with the dialog (the project disappears from their picker and old entries stay), and check **Assignment history**.
6. Remove someone's line manager: their submit buttons are disabled with an explanation.

**Still to verify on the live Supabase project** (these could not be exercised outside it):
- PostgREST embedded joins with column hints, e.g. `profiles!employee_id`, `profiles!reviewed_by`
- RPC calls over the REST API: `approval_records` with all 14 named parameters, `approval_counts().maybeSingle()`, `my_loggable_projects`, `org_overview`
- `notify pgrst, 'reload schema'` picking up the new table and functions (or click *Reload schema* in the API settings)

The SQL behind all of these was tested; only the HTTP layer is unverified.

---

## Appendix — full test results

| # | Result | Check |
|---|---|---|
| 1 | PASS | E1 submits leave (goes to line manager) |
| 2 | PASS | E1 cannot set approval_route from the client |
| 3 | PASS | E1 cannot start leave in the past |
| 4 | PASS | E1 last day before first day refused |
| 5 | PASS | E1 reason is mandatory |
| 6 | PASS | E1 balance check still works |
| 7 | PASS | E1 logs time today on assigned project WEB |
| 8 | PASS | E1 cannot log time on unassigned project APP |
| 9 | PASS | E1 cannot log time for a past date |
| 10 | PASS | E1 only sees assigned projects in timesheet picker |
| 11 | PASS | E1 submits today's timesheet |
| 12 | PASS | E1 cannot submit the same day twice |
| 13 | PASS | E1 timesheet routed to line manager |
| 14 | PASS | E1 cannot decide own leave |
| 15 | PASS | E1 cannot approve a colleague (not their manager) |
| 16 | PASS | E1 approval history (others) is empty |
| 17 | PASS | E1 cannot call org_overview |
| 18 | PASS | E1 cannot insert project membership directly |
| 19 | PASS | E1 cannot assign self via RPC |
| 20 | PASS | E1 cannot write leave history |
| 21 | PASS | E1 cannot change timesheet review history |
| 22 | PASS | E1 leave notified line manager |
| 23 | PASS | E1 leave NOT sent to HR |
| 24 | PASS | E1 timesheet notified line manager only |
| 25 | PASS | Employee without a line manager cannot submit leave |
| 26 | PASS | Employee without a line manager can still save a draft |
| 27 | PASS | Orphan logs time on OLD (back-filled membership) |
| 28 | PASS | Employee without a line manager cannot submit a timesheet |
| 29 | PASS | No HR fallback notification for orphan |
| 30 | PASS | Manager submits own leave |
| 31 | PASS | Manager leave routed to HR |
| 32 | PASS | Manager logs time on APP (back-filled) |
| 33 | PASS | Manager submits own timesheet |
| 34 | PASS | Manager cannot decide own timesheet |
| 35 | PASS | Manager cannot decide own leave |
| 36 | PASS | Manager actionable queue = direct reports only (no own items) |
| 37 | PASS | Manager approves direct report E1 leave |
| 38 | PASS | Manager must give a note to reject |
| 39 | PASS | Manager approves direct report E1 timesheet |
| 40 | PASS | Manager approval_counts reflects remaining work |
| 41 | PASS | Manager leave notified HR (both HR users) |
| 42 | PASS | Manager leave NOT sent to her own line manager (Leadership) |
| 43 | PASS | Decision history row recorded (from/to, approver, role, owner) |
| 44 | PASS | Timesheet decision history recorded |
| 45 | PASS | Employee notified of approval |
| 46 | PASS | Audit log written for decision |
| 47 | PASS | Leadership (Mona's line manager) cannot decide Mona's leave |
| 48 | PASS | Leadership cannot decide Mona's timesheet |
| 49 | PASS | Leadership sees direct reports' history read-only |
| 50 | PASS | Leadership org overview allowed |
| 51 | PASS | Leadership cannot change project teams |
| 52 | PASS | Leadership submits own leave |
| 53 | PASS | Leadership leave routed to HR |
| 54 | PASS | PM logs time on own project without membership |
| 55 | PASS | PM submits own timesheet (-> HR) |
| 56 | PASS | PM timesheet routed to HR |
| 57 | PASS | PM assigns E2 to own project WEB |
| 58 | PASS | PM cannot assign the same person twice |
| 59 | PASS | PM cannot assign an inactive employee |
| 60 | PASS | PM cannot assign to another PM's project |
| 61 | PASS | PM archives own project OLD |
| 62 | PASS | Cannot assign to an archived project |
| 63 | PASS | PM reads team of own project |
| 64 | PASS | PM cannot read team of another PM's project |
| 65 | PASS | E2 logs time on WEB after assignment |
| 66 | PASS | Other PM cannot unassign from WEB |
| 67 | PASS | PM2 (reports to a manager) submits own leave |
| 68 | PASS | PM2 leave goes to HR, not to line manager Mona |
| 69 | PASS | Manager sees PM2 (direct report) pending leave in history, cannot decide |
| 70 | PASS | Manager cannot decide PM2 leave (HR route) |
| 71 | PASS | PM unassigns E2 from WEB |
| 72 | PASS | Unassigning again fails cleanly |
| 73 | PASS | PM re-assigns E2 (new history row) |
| 74 | PASS | Assignment history preserved (1 inactive + 1 active) |
| 75 | PASS | PM unassigns E2 again |
| 76 | PASS | E2 still sees historical WEB entry after unassignment |
| 77 | PASS | E2 may still edit the existing WEB entry text (no project change) |
| 78 | PASS | E2 cannot add a new WEB entry after unassignment |
| 79 | PASS | WEB no longer in E2 picker |
| 80 | PASS | E2 cannot read E1's leave |
| 81 | PASS | E2 cannot read E1's timesheets |
| 82 | PASS | E2 cannot read E1's leave history |
| 83 | PASS | E2 sees own membership history |
| 84 | PASS | HR actionable queue holds only HR-route items |
| 85 | PASS | HR sees organisation-wide history (incl. employees) |
| 86 | PASS | HR cannot decide a normal employee's leave |
| 87 | PASS | HR cannot review a normal employee's timesheet |
| 88 | PASS | HR approves Manager leave |
| 89 | PASS | HR requests changes on Manager timesheet |
| 90 | PASS | HR rejects PM2 leave |
| 91 | PASS | HR approves PM timesheet |
| 92 | PASS | HR approves legacy Manager leave re-routed to HR |
| 93 | PASS | HR assigns E2 to APP (organisation-wide) |
| 94 | PASS | HR filter: timesheets on APP |
| 95 | PASS | HR filter: search by name |
| 96 | PASS | HR filter: approver |
| 97 | PASS | HR filter: role=pm |
| 98 | PASS | HR filter: department |
| 99 | PASS | HR filter: status rejected |
| 100 | PASS | HR pagination: total_count stable across pages |
| 101 | PASS | HR sort by name asc |
| 102 | PASS | HR never sees own records in approval history |
| 103 | PASS | HR own leave needs a line manager (HR is not self-routed) |
| 104 | PASS | HR cannot delete approval history |
| 105 | PASS | Manager notified of HR decision (with HR tag) |
| 106 | PASS | Manager notified of HR change request |
| 107 | PASS | History trigger blocks updates for logged-in users even as owner |
| 108 | PASS | Manager corrects the day HR sent back |
| 109 | PASS | Manager resubmits |
| 110 | PASS | Resubmission still routed to HR |
| 111 | PASS | Manager request refused when no HR user is active |
| 112 | PASS | Admin sees legacy orphan items (no line manager) as decidable |
| 113 | PASS | Admin decides legacy orphan leave |
| 114 | PASS | Admin cannot decide HR-route items |
| 115 | PASS | Admin manages any project team |
| 116 | PASS | Admin can read audit log |
| 117 | PASS | Approved leave cannot be cancelled |
| 118 | PASS | Approved timesheet cannot be edited (0 rows) |
| 119 | PASS | ...and the update changed nothing |
| 120 | PASS | E2 submits timesheet |
| 121 | PASS | E2 edits within 30 minutes |
| 122 | PASS | E2 edit after 30 minutes refused (0 rows) |
| 123 | PASS | E2 cannot submit again after window |
| 124 | PASS | ...late edit changed nothing |
| 125 | PASS | E1 submits another leave |
| 126 | PASS | Manager requests changes |
| 127 | PASS | E1 saves it as draft |
| 128 | PASS | Draft with history cannot be deleted (kept for history) |
| 129 | PASS | E1 resubmits |
| 130 | PASS | Resubmission clears the old decision and keeps first submission time |
| 131 | PASS | Full leave history: Submitted, Changes requested, Resubmitted |
| 132 | PASS | Leave balance includes pending + approved |

**132 passed, 0 failed.**
