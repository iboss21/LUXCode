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

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Lux orchestrator running" });
});

/**
 * POST /projects
 * body: { name, stack, description }
 *
 * stack: "next" | "vite-react" | "astro"
 */
app.post("/projects", async (req, res) => {
  const { name, stack, description } = req.body || {};

  if (!name || !stack) {
    return res.status(400).json({ error: "name and stack are required" });
  }

  const slug = slugify(name, { lower: true, strict: true });
  const projectDir = `/workspace/${slug}`;

  try {
    log(`Creating project "${name}" (${stack}) at ${projectDir}`);

    let createCmd;
    switch (stack) {
      case "next":
        createCmd =
          `npx create-next-app@latest ${slug} ` +
          `--ts --use-npm --eslint --tailwind --src-dir --app --no-install`;
        break;

      case "vite-react":
        createCmd = `npm create vite@latest ${slug} -- --template react`;
        break;

      case "astro":
        createCmd = `npm create astro@latest ${slug} -- --template basics`;
        break;

      default:
        return res.status(400).json({ error: `Unknown stack: ${stack}` });
    }

    // 1) scaffold
    await run(createCmd);

    // 2) install dependencies
    await run("npm install", projectDir);

    // 3) basic git init (optional)
    await run("git init && git add . && git commit -m 'Initial scaffold from orchestrator'", projectDir);

    // TODO: here you can also:
    // - create GitHub repo via API and push
    // - call Coolify HTTP API to create/deploy app based on this folder

    res.json({
      ok: true,
      slug,
      stack,
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
