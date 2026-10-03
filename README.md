# AI Daily Operations Copilot

An agentic AI assistant for a startup that works on client requests.

1. A client mails the company address.
2. The copilot reads the mail, **splits the work into tasks** and **assigns each task** to the right employee by skill, seniority level and current workload.
3. Every employee sees their tasks, how much of the project is theirs, and a scrolling work log (ongoing, to do, done) with **pop-up notifications**.
4. If an employee is stuck, the copilot **mails the team lead** (and the admin when the blocker is critical).
5. When the last task is finished, the copilot **mails the client a summary of all the work done**.

It also tracks pending tasks, priorities, deadlines and operational risks, and gives the lead actionable recommendations (remind, reassign, clear a blocker).

## Project layout

```
server.js            HTTP server: JSON API + live events (SSE) + serves /public
src/config.js        All settings, read from environment variables / .env
src/seed.js          Default employees and default work. EDIT THIS to match your real team
src/store.js         JSON-file database (data/db.json)
src/planner.js       Splits a client mail into tasks (rule-based, or Claude if a key is set)
src/assign.js        Assignment engine: skill + level + workload scoring, risk detection
src/service.js       Business rules: intake, progress, blockers, escalation, completion mail
src/mailer.js        Sends mail via SMTP (nodemailer); dry-run when SMTP is not configured
src/inbox.js         Reads the company mailbox via IMAP and turns new mails into projects
public/index.html    Front end (admin console + one view per employee)
test/smoke.test.js   End-to-end tests (node --test, no extra packages)
```

## Run it locally

Requires Node.js 18 or newer.

```bash
npm install
cp .env.example .env        # optional: the app also runs with no settings (dry-run mode)
npm start
# open http://localhost:3000
npm test                    # runs the end-to-end tests
```

With no `.env` the app runs in **dry-run mode**: the planner is rule-based and mails are only logged in the Outbox tab. Nothing is sent.

## Turn on the real features

| Feature | Settings in `.env` |
| --- | --- |
| Send real mail (acknowledgement, escalation, completion) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| Read the company mailbox automatically | `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASS`, `IMAP_POLL_SECONDS` |
| Claude splits the work (smarter than the rules) | `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` |
| Who gets escalations | `TEAM_LEAD_NAME`, `TEAM_LEAD_EMAIL`, `ADMIN_EMAIL`, `DELIVERY_EMAIL` |

**Gmail / Google Workspace:** turn on 2-step verification, create an *App Password* and use it as `SMTP_PASS` and `IMAP_PASS`. Use `smtp.gmail.com` (port 465) and `imap.gmail.com` (port 993). The copilot only reads **unread** mail in the inbox and marks each one as read after creating a project from it. It ignores its own mails, no-reply and bounce senders.

Escalation mails are sent from the authenticated mailbox, with the employee's address as Reply-To, because SMTP servers do not let you send as another person.

## API

| Method | Route | What it does |
| --- | --- | --- |
| GET | `/api/state` | Everything: employees, projects, tasks, outbox, notifications, activity |
| GET | `/api/events` | Live stream (SSE): `notification` pop-ups and `state` change pings |
| POST | `/api/mails` | New client mail: `{name, email, subject, body, deadline?, priority?, useAI?}` |
| POST | `/api/tasks/:id/start` | Start a task |
| POST | `/api/tasks/:id/progress` | `{progress: 0-100}`; 100 completes the task |
| POST | `/api/tasks/:id/complete` | Mark complete |
| POST | `/api/tasks/:id/blocker` | `{text, severity: "normal" \| "critical"}` mails the lead (and admin) |
| POST | `/api/tasks/:id/resolve` | Lead clears a blocker |
| POST | `/api/tasks/:id/reassign` | `{assignee: "e3"}` |
| POST | `/api/tasks/:id/nudge` | Send the assignee a reminder pop-up |
| POST | `/api/notifications/read` | `{to: "lead" \| "e1"}` |
| POST | `/api/reset` | Restore the demo data |
| GET | `/api/health` | Health check |

Test a mail without the UI:

```bash
curl -X POST localhost:3000/api/mails -H 'content-type: application/json' -d '{
  "name":"Rohan Mehta","email":"rohan@client.example",
  "subject":"Grocery delivery web app",
  "body":"We need a responsive web app with live order tracking. Urgent, investor demo Friday."}'
```

## How the assignment works

For each task the engine scores every employee and picks the highest:

`score = skill match (3 main skill, 1.5 second skill, 0 none) + level fit (+1 if seniority covers the task, -1.5 if not) - 2.5 x (queued hours / daily capacity)`

Tasks are assigned one after another, so the load from the first task is counted when the second is placed. Deadlines for the tasks are spread evenly up to the client deadline. Priority is Urgent / High / Normal, from the client's wording and how close the deadline is (or set by hand).

## Deploy

### Option A: Render (easiest, free tier available)

1. Push this folder to a GitHub repository.
2. On render.com choose **New > Web Service**, connect the repo.
3. Build command `npm install`, start command `npm start`.
4. Add the environment variables from `.env.example` in the dashboard.
5. Deploy. Render gives you a public `https://...onrender.com` URL.

Free instances sleep when idle and have no persistent disk, so `data/db.json` resets on restart. For a real deployment use a paid instance with a disk (see `render.yaml`) and set `DATA_FILE=/var/data/db.json`. The IMAP poller only runs while the service is awake.

### Option B: Railway

New Project > Deploy from GitHub repo. Add the variables, add a Volume mounted at `/data` and set `DATA_FILE=/data/db.json`. Railway detects Node and runs `npm start`.

### Option C: Any server or VPS with Docker

```bash
docker build -t ops-copilot .
docker run -d -p 3000:3000 -v copilot-data:/data --env-file .env --name ops-copilot ops-copilot
```

Put it behind HTTPS (Caddy, Nginx or your host's proxy).

## Before real use

- **Add login.** There is no authentication: anyone with the URL can use every endpoint. Add a login (or put the app behind your company VPN / an auth proxy) before exposing it publicly.
- **Employees are chosen in the browser.** The "Viewing as" switch is a demo switch, not a security boundary. Real per-employee login is the next step.
- **Storage is one JSON file.** Fine for one server and a small team. Replace `src/store.js` with Postgres or MongoDB to scale.
- Edit `src/seed.js` to put in your real staff, skills and work emails, then delete `data/db.json` to re-seed.
