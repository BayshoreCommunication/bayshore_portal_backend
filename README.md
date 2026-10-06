# Bayshore Portal Backend

Bayshore Portal is a company and client management portal. This is its API. It serves the company portal (staff) and the client portal (clients).

It handles sign in, users and roles, clients, weekly and monthly reports, and an audit log, all stored in MongoDB.

Run `npm install`, add a `.env` file, then `npm run dev`. Create the first superadmin with `npm run seed:superadmin`. API docs are at `/api-docs`.

Pushing to `main` deploys to the DigitalOcean droplet through `.github/workflows/deploy.yml`: GitHub Actions builds the release, copies it to `/var/www/bayshoreportal_backend`, reloads PM2, and rolls back if `/api/v1/health` does not answer. The production `.env` lives on the droplet in `shared/.env`. `deploy/setup-droplet.sh` prepares a new droplet.
