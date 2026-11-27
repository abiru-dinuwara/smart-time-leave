# Smart Time & Leave Assistant

A real, multi-user web app for timesheets, leave requests and approvals.
Built with **Next.js 16** (pages) and **Supabase** (database + login).

## What works in this first version (stage 1)

| Area | What it does |
|---|---|
| Login | Email + password. Only people you create can sign in. |
| Roles | Employee, Manager, Project Manager, HR, Leadership, Administrator. Each sees only their own menu and data. |
| Timesheet | **Daily** timesheet for today only (company time zone). Several project/task entries per day, all fields required. Submit once per day; the database stamps the submission time. Entries can be edited for **30 minutes** after submitting, and never after the manager has decided. If the manager requests changes, the employee corrects that day and resubmits. |
| Leave | Request leave (full or half day) from today onwards — past dates are refused, the Last Day can't be before the First Day, and a reason is required. Approved leave cannot be cancelled by the employee. Also: automatic working-day count (weekends and company holidays excluded), balances per year, overlap and balance checks, cancel, edit and resubmit. |
| Approvals | **Role-based routing, decided by the database.** Employees (and HR / admin users) → their **line manager**. Managers, Project Managers and Leadership → **HR**. Applies to both daily timesheets and leave. Nobody can approve their own request, and there is no HR fallback for employees: without an active line manager they cannot submit. Approve, reject or request changes with a comment (confirmed in a dialog); the requester is notified. |
| History | **My Timesheet → History** and **My Leave → History** for every user (own records only). **Approval History** for line managers (their direct reports) and HR (organisation-wide) with search, filters (employee, department, role, project, type, status, dates, approver), sorting and pagination. Every decision is stored permanently with previous/new status, approver, role, comment and time — nobody can edit or delete it. |
| Notifications | In-app notifications for every step. |
| People | Administrator / HR set role, manager, department, and deactivate accounts. |
| Policies & Holidays | HR sets yearly allowances and company holidays. Administrator sets company name, hours per day, time zone, sign-up domain. |
| Projects | Project managers create projects and **assign / unassign employees** to their own projects (HR and administrators: any project; leadership: read-only). Assignment history is kept. Employees can only log time on active projects they are assigned to — checked in the database. Approved hours count toward each project's effort. |
| Dashboards | Separate sections for employees, line managers, project managers, HR and leadership/administrators. Org-wide figures are totals only. |
| Audit log | Administrators see a permanent record of important actions. |

The rules (leave balance, overlaps, who can see what) are enforced **in the database**, so nobody can bypass them by editing the web page.

**Not in this version yet** (planned for stage 2): calendar view, reports and utilisation charts, CSV / payroll export, the AI leave assistant and AI time suggestions, Google/Outlook/Jira/Slack integrations, inviting people from inside the app, "forgot password" page, project tasks and members.

---

## 1. Set up (about 20 minutes)

You need: **Node.js 20 or newer** (nodejs.org) and a free **Supabase** account (supabase.com).

### Step 1 — Create the database

1. In Supabase click **New project**. Choose a name, a strong database password (save it) and the region closest to your staff.
2. Open **SQL Editor → New query**.
3. Open `supabase/migrations/0001_schema.sql` from this folder, copy everything, paste it into the editor and click **Run**. It should say *Success*.
4. Do the same with `supabase/migrations/0002_security.sql`.
5. Do the same with `supabase/migrations/0003_daily_timesheet_leave_workflow.sql`, then `0004_leave_without_manager.sql`, then `0005_role_routing_history_projects.sql`.

> **Already running an earlier version?** Run only the migrations you have not run yet (for most installs: `0005_role_routing_history_projects.sql`). It keeps all existing data — see `docs/UPDATE-0005.md` for what it changes and what to check afterwards.

> Run them in that order, once each. If you make a mistake on a fresh project, you can delete the project and start again.

### Step 2 — Connect the app

1. In Supabase open **Project Settings → API**. Copy the **Project URL** and the **publishable key**.
2. In this folder, copy `.env.local.example` to a new file named `.env.local` and paste the two values in.
3. In a terminal inside this folder run:

```bash
npm install
npm run dev
```

4. Open http://localhost:3000. You should see the sign-in page.

> Never put the `service_role` / secret key in this app or in `.env.local`. It is not needed.

### Step 3 — Create the first administrator

1. In Supabase open **Authentication → Users → Add user → Create new user**. Enter your work email and a password, and tick **Auto Confirm User**.
2. Sign in at http://localhost:3000.

**The very first person created becomes the System Administrator automatically.** Everyone created after that starts as an Employee.

### Step 4 — Set up the company (as administrator)

1. **Policies & Holidays**: set your company name, hours per day, time zone (for example `Asia/Colombo`), the leave allowances and your public holidays.
2. Create accounts for your staff the same way as in step 3 (Authentication → Users).
3. **People**: for each person set their **line manager** and **role**. Employees, HR and administrators need an active line manager to submit timesheets and leave (the People page lists anyone missing one). Managers, Project Managers and Leadership are approved by HR, so make sure at least one person has the **HR** role.
4. **Projects**: ask a Project Manager to create projects (or create them yourself), then open each project and **assign** the employees who work on it. People can only log time on active projects they are assigned to (a project's own PM can always log time on it).

---

## 2. Put it on the internet (Vercel)

1. Put this folder in a GitHub repository (the `.gitignore` already keeps `.env.local` out).
2. On vercel.com choose **Add New → Project**, import the repository.
3. Under **Environment Variables** add the same two values as `.env.local`.
4. Click **Deploy**.
5. In Supabase open **Authentication → URL Configuration** and set **Site URL** to your Vercel address (or your own domain).

## 3. Before real staff use it — checklist

- [ ] In Supabase **Authentication → Sign In / Providers**, switch **off** "Allow new users to sign up". Then only people you add can get in.
- [ ] Set **Allowed email domain** in Policies & Holidays (Organisation card) as a second lock.
- [ ] Set up a **custom email sender (SMTP)** under Authentication → SMTP. Supabase's built-in email is only for testing and is heavily limited.
- [ ] Turn on **backups**. Check your Supabase plan: automatic daily backups are part of the paid plans, so use a paid plan for real company data.
- [ ] Use a strong password for every administrator account.
- [ ] Try each role once with a test account (employee, manager, HR) and check that the menus and data look right.
- [ ] Decide who is allowed to see people's leave and hours, and tell staff. Managers see their direct reports, HR sees everyone (and the organisation-wide approval history), Leadership sees totals and the employee overview, and Project Managers see hours logged on their own projects.
- [ ] Check that every employee has an active line manager and that at least one active HR user exists (otherwise managers, PMs and leadership cannot submit).

## 4. How the code is organised

```
supabase/migrations/   database tables, rules and security (SQL)
src/proxy.ts           keeps people logged in and sends visitors to /login
src/app/(app)/         the pages (one folder per menu item), each with its actions.ts
src/app/(app)/_dashboard/  the role-based dashboard sections
src/lib/               helpers: dates, login, menus, types, approval routing / history filters
src/components/        app shell, design-system pieces, confirm dialog, approval table
supabase/tests/        role & permission test suite (local throwaway PostgreSQL only)
docs/UPDATE-0005.md    what changed in the role-routing / history / projects update
```

When you change the database later, add a new file such as `0003_something.sql` and run it in the SQL Editor. Do not edit the earlier files after you have real data. `0003_daily_timesheet_leave_workflow.sql` is such an incremental change: it keeps all existing data and can be run on a live database.

## 5. Troubleshooting

| Problem | What to do |
|---|---|
| "Database error creating new user" in Supabase | The email domain does not match **Allowed email domain**. Change it or clear it. |
| After sign-in you see nothing / are sent back to login | Your account has no profile or is deactivated. Check **Table Editor → profiles**. |
| "Your project's URL and key are required" | `.env.local` is missing or you did not restart `npm run dev` after creating it. |
| An employee says "Not enough annual leave" | Their balance for that calendar year is used up. HR can raise the allowance in Policies & Holidays. |
| A manager sees no approvals | The employee has no line manager set on the People page. Requests from managers, PMs and leadership go to HR, not to their own line manager. |
| "You do not have an active line manager…" | Employees (and HR / admin users) need an active line manager to submit. Set one on the People page. |
| "There is no active HR approver…" | Managers, PMs and leadership are approved by HR. Give at least one active person the HR role. |
| "You are not assigned to this project" | Ask the project manager (or HR) to add you to the project team on the Projects page. |
| HR cannot approve an employee's request | Working as designed: employees' requests are decided by their line manager only. |
| "The 30-minute editing period has ended" | Working as designed. Ask the manager to use **Request changes** on that day; the employee can then correct and resubmit it. |

## 6. Checking the database and running the tests

**Check that migration 0005 is installed (safe, read-only):** in Supabase open **SQL Editor → New query**, paste all of `supabase/tests/verify_0005_supabase.sql` and click **Run**. Every row should show `ok = true`; the *info* rows list things to act on (for example, people without an active line manager).

> The other files in `supabase/tests/` (`00_…` to `40_…`) are **local test files**. They use `psql` commands and create fake users, so they must never be run in the Supabase SQL Editor. Each one stops itself if it detects a Supabase database.

**Permission tests (optional, for developers):**

`supabase/tests/` contains 132 automated checks of the approval routing, history, project assignments and the earlier rules (daily timesheet, 30-minute window, leave dates, balances). They run against a **throwaway local PostgreSQL** (15 or newer), never against Supabase:

```bash
PGHOST=localhost PGPORT=5432 PGUSER=postgres ./supabase/tests/run_local_tests.sh
```

The last lines show `passed | failed`.
