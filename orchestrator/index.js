import express from "express";
import bodyParser from "body-parser";
import slugify from "slugify";
import { exec } from "child_process";
import { promisify } from "util";

const app = express();
const port = 3000;
const sh = promisify(exec);

app.use(bodyParser.json());

function log(...args) {
  console.log("[orchestrator]", ...args);
}

async function run(cmd, cwd = "/workspace") {
  log("RUN:", cmd, "in", cwd);
  const { stdout, stderr } = await sh(cmd, { cwd, shell: "/bin/bash" });
  if (stdout) log("OUT:", stdout);
  if (stderr) log("ERR:", stderr);
  return { stdout, stderr };
}

/**
 * Stack registry: define all stacks here.
 *
 * Each stack has:
 * - scaffold: command to create project
 * - postInstall: array of commands to run afterwards (optional)
 * - templateRepo: for git clone/degit templates (optional)
 */
const STACKS = {
  "next-basic": {
    label: "Next.js Basic",
    scaffold: (slug) =>
      `npx create-next-app@latest ${slug} ` +
      `--ts --use-npm --eslint --tailwind --src-dir --app --no-install`,
    postInstall: ["npm install"]
  },

  // Full stack Next.js – use your own template repo instead of raw CLI
  "next-full": {
    label: "Next Full Stack (Prisma, tRPC, Auth)",
    // replace this with your real template repo
    templateRepo: "https://github.com/iboss21/next-fullstack-template.git",
    scaffold: (slug) =>
      // clone template into slug folder
      `git clone ${STACKS["next-full"].templateRepo} ${slug}`,
    postInstall: [
      "npm install",
      "npx prisma generate || true" // if prisma is used
    ]
  },

  "vite-react": {
    label: "Vite + React",
    scaffold: (slug) => `npm create vite@latest ${slug} -- --template react`,
    postInstall: ["npm install"]
  },

  // Opinionated Astro marketing template
  "astro-landing": {
    label: "Astro Landing Page",
    // if you make a repo like iboss21/astro-landing-template
    templateRepo: "https://github.com/iboss21/astro-landing-template.git",
    scaffold: (slug) =>
      `git clone ${STACKS["astro-landing"].templateRepo} ${slug}`,
    postInstall: ["npm install"]
  }
};

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Lux orchestrator running",
    stacks: Object.entries(STACKS).map(([key, value]) => ({
      id: key,
      label: value.label
    }))
  });
});

/**
 * POST /projects
 * body: { name, stack, description }
 *
 * stack: one of Object.keys(STACKS)
 */
app.post("/projects", async (req, res) => {
  const { name, stack, description } = req.body || {};

  if (!name || !stack) {
    return res
      .status(400)
      .json({ error: "name and stack are required", stacks: Object.keys(STACKS) });
  }

  const config = STACKS[stack];
  if (!config) {
    return res
      .status(400)
      .json({ error: `Unknown stack: ${stack}`, stacks: Object.keys(STACKS) });
  }

  const slug = slugify(name, { lower: true, strict: true });
  const projectDir = `/workspace/${slug}`;

  try {
    log(`Creating project "${name}" (${stack}) at ${projectDir}`);

    // 1) scaffold
    const scaffoldCmd = config.scaffold(slug);
    await run(scaffoldCmd);

    // 2) post install commands
    if (config.postInstall && config.postInstall.length) {
      for (const cmd of config.postInstall) {
        await run(cmd, projectDir);
      }
    }

    // 3) basic git init (optional)
    await run(
      "git init && git add . && git commit -m 'Initial scaffold from orchestrator'",
      projectDir
    );

    res.json({
      ok: true,
      slug,
      stack,
      label: config.label,
      projectDir,
      description
    });
  } catch (err) {
    log("ERROR:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(port, () => {
  log(`Listening on port ${port}`);
});
