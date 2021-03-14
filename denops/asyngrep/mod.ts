import "https://deno.land/x/lodash@4.17.19/dist/lodash.js";
import * as path from "https://deno.land/std@0.90.0/path/mod.ts";
import { exists } from "https://deno.land/std@0.90.0/fs/mod.ts";
import { isWindows } from "https://deno.land/std@0.90.0/_util/os.ts";
import { parse } from "https://deno.land/std@0.90.0/encoding/toml.ts";
import { parse as flags } from "https://deno.land/std@0.90.0/flags/mod.ts";
import { start } from "https://deno.land/x/denops_std@v0.3/mod.ts";
const _ = (self as any)._;

let debug = false;

type Tool = {
  name: string;
  cmd: string;
  arg: string[];
};

const clog = (...data: any[]): void => {
  if (debug) {
    console.log(...data);
  }
};

start(async (vim) => {
  // debug.
  try {
    debug = await vim.g.get("asyngrep_debug");
  } catch (e) {
    // console.log(e);
  }

  const pathname = new URL(".", import.meta.url).pathname;
  const dir = isWindows ? pathname.slice(1) : pathname;
  const toml = path.join(dir, "config.toml");
  let cfg = parse(await Deno.readTextFile(toml));

  // User config.
  let userToml = (await vim.call("expand", "~/.asyngrep.toml")) as string;
  try {
    userToml = (await vim.call(
      "expand",
      (await vim.g.get("asyngrep_cfg_path")) as string
    )) as string;
  } catch (e) {
    // clog(e);
  }
  clog(`g:asyngrep_cfg_path = ${userToml}`);
  if (await exists(userToml)) {
    clog(`Merge user config: ${userToml}`);
    cfg = { ...cfg, ...parse(await Deno.readTextFile(userToml)) };
  }

  cfg = cfg as Record<string, Tool[]>;

  clog({ cfg });

  // Set default name.
  const tools = cfg.tool as Tool[];
  const executable = tools.find(
    async (x) => (await vim.call("executable", x.cmd)) as boolean
  );
  const def = tools.find((x) => x.name === "default") ?? executable;
  clog({ def });

  vim.register({
    async asyngrep(...args: unknown[]): Promise<unknown> {
      clog({ args });
      const arg = args as string[];
      const a = flags(arg);
      const pattern =
        a._.length > 0
          ? a._.join(" ")
          : await vim.call("input", "Search for pattern: ");
      const tool = a.tool ? tools.find((x) => x.name === a.tool) : def;
      clog({ pattern });
      clog({ tool });
      if (!tool) {
        console.warn(`Grep tool is not found !`);
        return await Promise.resolve();
      }
      const userArg = arg.filter(
        (x) => ![...a._, `--tool=${tool.name}`].includes(x)
      );
      clog({ userArg });

      const toolArg = _.uniq([...tool.arg, ...userArg].filter((x) => x));
      const cmd = [tool.cmd, ...toolArg, pattern] as string[];
      const cwd = (await vim.call("getcwd")) as string;
      clog({ cmd, cwd });
      const p = Deno.run({ cmd, cwd, stderr: "piped", stdout: "piped" });
      const [status, stdoutArray, stderrArray] = await Promise.all([
        p.status(),
        p.output(),
        p.stderrOutput(),
      ]);
      const stdout = new TextDecoder().decode(stdoutArray);
      const stderr = new TextDecoder().decode(stderrArray);
      p.close();

      clog({ status, stdout, stderr });
      await vim.call("setqflist", [], "r");
      await vim.call("setqflist", [], "a", {
        title: `[Search results for ${pattern}]`,
      });
      await vim.call("setqflist", [], "a", { lines: stdout.split("\n") });
      await vim.execute("botright copen");
      return await Promise.resolve();
    },
  });

  await vim.execute(`
    command! -nargs=* Agp call denops#notify('${vim.name}', 'asyngrep', [<f-args>])
  `);

  clog("dps-asyngrep has loaded");
});
