# Smart Time & Leave Assistant

A real, multi-user web app for timesheets, leave requests and approvals.
Built with **Next.js 16** (pages) and **Supabase** (database + login).

## What works in this first version (stage 1)

| Area | What it does |
|---|---|
| Login | Email + password. Only people you create can sign in. |
| Roles | Employee, Manager, Project Manager, HR, Leadership, Administrator. Each sees only their own menu and data. |
| Timesheet | Add, edit and delete entries by day, see weekly totals, submit a week for approval, see manager feedback. |
| Leave | Request leave (full or half day), automatic working-day count (weekends and company holidays excluded), balances per year, overlap and balance checks, cancel, edit and resubmit. |
| Approvals | Managers (and HR) approve, reject or request changes on leave and timesheets, with a note. The employee is notified. |
| Notifications | In-app notifications for every step. |
| People | Administrator / HR set role, manager, department, and deactivate accounts. |
| Policies & Holidays | HR sets yearly allowances and company holidays. Administrator sets company name, hours per day, time zone, sign-up domain. |
| Projects | Project managers create projects; approved hours count toward each project's effort. |
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
3. **People**: for each person set their **line manager** and **role**. Leave requests and timesheets go to the line manager. If someone has no manager, HR approves.
4. **Projects**: ask a Project Manager to create projects (or create them yourself). People can only log time against active projects.

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
- [ ] Decide who is allowed to see people's leave and hours, and tell staff. Managers see their direct reports, HR and Leadership see everyone, and Project Managers see hours logged on their own projects.

## 4. How the code is organised

```
supabase/migrations/   database tables, rules and security (SQL)
src/proxy.ts           keeps people logged in and sends visitors to /login
src/app/(app)/         the pages (one folder per menu item), each with its actions.ts
src/lib/               helpers: dates, login, menus, types
src/components/        sidebar / top bar and small UI pieces
```

When you change the database later, add a new file such as `0003_something.sql` and run it in the SQL Editor. Do not edit the first two files after you have real data.

## 5. Troubleshooting

| Problem | What to do |
|---|---|
| "Database error creating new user" in Supabase | The email domain does not match **Allowed email domain**. Change it or clear it. |
| After sign-in you see nothing / are sent back to login | Your account has no profile or is deactivated. Check **Table Editor → profiles**. |
| "Your project's URL and key are required" | `.env.local` is missing or you did not restart `npm run dev` after creating it. |
| An employee says "Not enough annual leave" | Their balance for that calendar year is used up. HR can raise the allowance in Policies & Holidays. |
| A manager sees no approvals | The employee has no line manager set (HR sees those), or the manager is not set on the People page. |
