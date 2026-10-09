# KkrRegional

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.1.

## Running the school map

The browser cannot talk to PostgreSQL directly, so a small API in `server/index.mjs` runs the queries and the Angular dev server proxies `/api` to it (`proxy.conf.json`).

1. Copy `.env.example` to `.env` and fill in the database credentials and Google Maps API key (`.env` is git-ignored).
2. Run `npm start`. It starts the API (http://localhost:3000) and the app (http://localhost:4200) together; `npm run api` or `npm run web` start just one.

API endpoints:

- `GET /api/districts` – `SELECT DISTINCT district FROM schools`
- `GET /api/schools?district=...` – schools (name, level, coordinates) in a district
- `GET /api/config` – the Google Maps API key for the browser

The **Download satellite map & school list** button saves two files per district: a satellite JPEG stitched from Google Maps Static API images (pins, names and a scale bar) and a PNG list of every school with its coordinates. The key needs both the *Maps JavaScript API* and the *Maps Static API* enabled. Run the export on a computer: phone browsers cannot build images this large, though they can open the resulting file.

## Deploying to Vercel

Vercel does not run `server/index.mjs`. It serves the built app and runs each file in `api/` as a Vercel Function; those functions reuse the route code in `server/routes.mjs`, so local and deployed behaviour match. `vercel.json` sets the build output folder.

Before deploying, add these environment variables in the Vercel project (Settings → Environment Variables), because `.env` is not uploaded: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `GOOGLE_MAPS_API_KEY`. Redeploy after adding them.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
