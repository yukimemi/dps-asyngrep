import * as _ from "https://cdn.skypack.dev/lodash@4.17.21";
import * as path from "https://deno.land/std@0.95.0/path/mod.ts";
import { exists } from "https://deno.land/std@0.95.0/fs/mod.ts";
import { parse as flags } from "https://deno.land/std@0.95.0/flags/mod.ts";
import { parse } from "https://deno.land/std@0.95.0/encoding/toml.ts";
import { readLines } from "https://deno.land/std@0.95.0/io/mod.ts";
import { main } from "https://deno.land/x/denops_std@v0.8/mod.ts";

type Tool = {
  name: string;
  cmd: string;
  arg: string[];
};

main(async ({ vim }) => {
  // debug.
  const debug = await vim.g.get("asyngrep_debug", false);
  const clog = (...data: any[]): void => {
    if (debug) {
      console.log(...data);
    }
  };

  const pathname = new URL(".", import.meta.url);
  const dir = path.fromFileUrl(pathname);
  const toml = path.join(dir, "config.toml");
  let cfg = parse(await Deno.readTextFile(toml));
  clog({ cfg });

  // User config.
  const userToml = (await vim.call(
    "expand",
    (await vim.g.get("asyngrep_cfg_path", "~/.asyngrep.toml")) as string
  )) as string;
  clog(`g:asyngrep_cfg_path = ${userToml}`);
  if (await exists(userToml)) {
    clog(`Merge user config: ${userToml}`);
    cfg = {
      tool: [
        ...(cfg.tool as Tool[]),
        ...(parse(await Deno.readTextFile(userToml)).tool as Tool[]),
      ],
    };
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

  let p: Deno.Process;

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
      const cwd = (await vim.call("getcwd")) as string;
      const cmd = [tool.cmd, ...toolArg, pattern, cwd] as string[];
      clog(`pid: ${p?.pid}, rid: ${p?.rid}`);
      try {
        clog("close process");
        p.close();
      } catch (e) {
        clog(e);
      }
      clog({ cmd, cwd });
      p = Deno.run({
        cmd,
        cwd,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });

      clog(`pid: ${p?.pid}, rid: ${p?.rid}`);
      await vim.call("setqflist", [], "r");
      await vim.call("setqflist", [], "a", {
        title: `[Search results for ${pattern} on ${tool.cmd}]`,
      });
      await vim.execute("botright copen");

      for await (const line of readLines(p.stdout)) {
        clog({ line });
        await vim.call("setqflist", [], "a", { lines: [line] });
      }

      const [status, stdoutArray, stderrArray] = await Promise.all([
        p.status(),
        p.output(),
        p.stderrOutput(),
      ]);
      const stdout = new TextDecoder().decode(stdoutArray);
      const stderr = new TextDecoder().decode(stderrArray);
      p.close();

      clog({ status, stdout, stderr });
      return await Promise.resolve();
    },
  });

  await vim.execute(`
    command! -nargs=* Agp call denops#notify('${vim.name}', 'asyngrep', [<f-args>])
  `);

  clog("dps-asyngrep has loaded");
});
