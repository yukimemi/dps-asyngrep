import * as _ from "https://cdn.skypack.dev/lodash@4.17.21";
import * as flags from "https://deno.land/std@0.151.0/flags/mod.ts";
import * as fn from "https://deno.land/x/denops_std@v3.8.1/function/mod.ts";
import * as helper from "https://deno.land/x/denops_std@v3.8.1/helper/mod.ts";
import * as io from "https://deno.land/std@0.151.0/io/mod.ts";
import * as path from "https://deno.land/std@0.151.0/path/mod.ts";
import * as toml from "https://deno.land/std@0.151.0/encoding/toml.ts";
import * as vars from "https://deno.land/x/denops_std@v3.8.1/variable/mod.ts";
import { batch } from "https://deno.land/x/denops_std@v3.8.1/batch/mod.ts";
import {
  ensureArray,
  ensureNumber,
  ensureString,
} from "https://deno.land/x/unknownutil@v2.0.0/mod.ts";
import type { Denops } from "https://deno.land/x/denops_std@v3.8.1/mod.ts";

type Tool = {
  name: string;
  cmd: string;
  arg: string[];
};

export function existsSync(filePath: string): boolean {
  try {
    Deno.lstatSync(filePath);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

export async function main(denops: Denops): Promise<void> {
  // debug.
  const debug = await vars.g.get(denops, "asyngrep_debug", false);
  // deno-lint-ignore no-explicit-any
  const clog = (...data: any[]): void => {
    if (debug) {
      console.log(...data);
    }
  };

  const pathname = new URL(".", import.meta.url);
  const dir = path.fromFileUrl(pathname);
  const config = path.join(dir, "config.toml");
  let cfg = toml.parse(await Deno.readTextFile(config));
  clog({ cfg });

  // User config.
  const userToml = ensureString(
    await fn.expand(
      denops,
      ensureString(
        await vars.g.get(
          denops,
          "asyngrep_cfg_path",
          "~/.asyngrep.toml",
        ),
      ),
    ),
  );
  clog(`g:asyngrep_cfg_path = ${userToml}`);
  if (existsSync(userToml)) {
    clog(`Merge user config: ${userToml}`);
    cfg = {
      tool: [
        ...(ensureArray<Tool>(cfg.tool)),
        ...(ensureArray<Tool>(
          toml.parse(await Deno.readTextFile(userToml)).tool,
        )),
      ],
    };
  }

  cfg = cfg as Record<string, Tool[]>;

  clog({ cfg });

  // Set default tool name.
  const tools = ensureArray<Tool>(cfg.tool);
  const executable = tools.find(async (x) =>
    ensureNumber(await fn.executable(denops, x.cmd))
  );
  const def = tools.find((x) => x.name === "default") ?? executable;
  clog({ def });

  let p: Deno.Process;

  denops.dispatcher = {
    async asyngrep(...args: unknown[]): Promise<void> {
      try {
        clog({ args });
        const arg = ensureArray<string>(args);
        const a = flags.parse(arg);
        let pattern = a._.length > 0 ? a._.join(" ") : "";
        if (pattern === "") {
          const userInput = await helper.input(denops, {
            prompt: "Search for pattern: ",
          });
          if (userInput == null) {
            clog(`input is null ! so cancel !`);
            await helper.echo(denops, `dps-asyngrep: cancel !`);
            return;
          }
          pattern = userInput;
        }
        const tool = a.tool ? tools.find((x) => x.name === a.tool) : def;
        clog({ pattern });
        clog({ tool });
        if (!tool) {
          console.warn(`Grep tool [${a.tool}] is not found !`);
          return;
        }
        const cwd = a.path ?? ensureString(await fn.getcwd(denops));
        clog({ cwd });
        const userArg = arg.filter((x) =>
          ![...a._, `--tool=${tool.name}`, `--path=${cwd}`].includes(x)
        );
        clog({ userArg });

        const toolArg = _.uniq([...tool.arg, ...userArg].filter((x) => x));
        const cmd = ensureArray<string>([tool.cmd, ...toolArg, pattern]);
        clog(`pid: ${p?.pid}, rid: ${p?.rid}`);
        try {
          clog("close process");
          p.close();
        } catch (e) {
          clog(e);
        }
        const expandCwd = ensureString(await fn.expand(denops, cwd));
        clog({ cmd, expandCwd });
        await fn.chdir(denops, expandCwd);
        p = Deno.run({
          cmd,
          cwd: expandCwd,
          stdin: "null",
          stdout: "piped",
          stderr: "piped",
        });

        clog(`pid: ${p?.pid}, rid: ${p?.rid}`);
        await batch(denops, async (denops) => {
          await fn.setqflist(denops, [], "r");
          await fn.setqflist(denops, [], "a", {
            title: `[Search results for ${pattern} on ${tool.cmd}]`,
          });
          await denops.cmd("botright copen");
        });

        if (p.stdout === null) {
          return;
        }
        for await (const line of io.readLines(p.stdout)) {
          clog({ line });
          await fn.setqflist(denops, [], "a", { lines: [line] });
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
      } catch (e) {
        console.log(e);
      }
    },
  };

  await helper.execute(
    denops,
    `
    function! s:${denops.name}_notify(method, params) abort
      call denops#plugin#wait_async('${denops.name}', function('denops#notify', ['${denops.name}', a:method, a:params]))
    endfunction
    command! -nargs=* Agp call s:${denops.name}_notify('asyngrep', [<f-args>])
  `,
  );

  clog("dps-asyngrep has loaded");
}
