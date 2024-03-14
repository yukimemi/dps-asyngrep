import * as _ from "https://cdn.skypack.dev/lodash@4.17.21";
import * as flags from "https://deno.land/std@0.219.1/flags/mod.ts";
import * as fn from "https://deno.land/x/denops_std@v6.4.0/function/mod.ts";
import * as fs from "https://deno.land/std@0.219.1/fs/mod.ts";
import * as helper from "https://deno.land/x/denops_std@v6.4.0/helper/mod.ts";
import * as path from "https://deno.land/std@0.219.1/path/mod.ts";
import * as toml from "https://deno.land/std@0.219.1/toml/mod.ts";
import * as vars from "https://deno.land/x/denops_std@v6.4.0/variable/mod.ts";
import type { Denops } from "https://deno.land/x/denops_std@v6.4.0/mod.ts";
import { TextLineStream } from "https://deno.land/std@0.219.1/streams/mod.ts";
import { abortable } from "https://deno.land/std@0.219.1/async/mod.ts";
import { batch } from "https://deno.land/x/denops_std@v6.4.0/batch/mod.ts";
import { ensure, is } from "https://deno.land/x/unknownutil@v3.17.0/mod.ts";

type Tool = {
  name: string;
  cmd: string;
  arg: string[];
};

async function* iterLine(r: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const lines = r
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream());

  for await (const line of lines) {
    if (ensure(line, is.String).length) {
      yield ensure(line, is.String);
    }
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
  const userToml = ensure(
    await fn.expand(
      denops,
      ensure(
        await vars.g.get(denops, "asyngrep_cfg_path", "~/.asyngrep.toml"),
        is.String,
      ),
    ),
    is.String,
  );
  clog(`g:asyngrep_cfg_path = ${userToml}`);
  if (await fs.exists(userToml)) {
    clog(`Merge user config: ${userToml}`);
    cfg = {
      tool: [
        ...ensure(
          cfg.tool,
          is.ArrayOf((x): x is Tool => is.Record(x)),
        ),
        ...ensure(
          toml.parse(await Deno.readTextFile(userToml)).tool,
          is.ArrayOf((x): x is Tool => is.Record(x)),
        ),
      ],
    };
  }

  cfg = cfg as Record<string, Tool[]>;

  clog({ cfg });

  // Set default tool name.
  const tools = ensure(
    cfg.tool,
    is.ArrayOf((x): x is Tool => is.Record(x)),
  );
  const executable = tools.find(async (x) => ensure(await fn.executable(denops, x.cmd), is.Number));
  const def = tools.find((x) => x.name === "default") ?? executable;
  clog({ def });

  let p: Deno.ChildProcess;
  let abortController = new AbortController();

  denops.dispatcher = {
    async asyngrep(...args: unknown[]): Promise<void> {
      try {
        clog({ args });
        const arg = ensure(args, is.ArrayOf(is.String));
        const a = flags.parse(arg);
        const dir = a.path ?? await helper.input(denops, {
          prompt: "Search directory: ",
          text: ensure(await fn.getcwd(denops), is.String),
          completion: "dir",
        });
        clog({ dir });
        let pattern = a._.length > 0 ? a._.join(" ") : "";
        if (pattern === "") {
          const userInput = await helper.input(denops, {
            prompt: "Search for pattern: ",
          });
          if (userInput == null || userInput === "") {
            clog(`input is nothing ! so cancel !`);
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
        const userArg = arg.filter(
          (x) => ![...a._, `--tool=${tool.name}`, `--path=${dir}`].includes(x),
        );
        clog({ userArg });

        const toolArg = [...tool.arg, ...userArg];
        const cmdArgs = ensure([...toolArg, pattern], is.ArrayOf(is.String));
        clog(`pid: ${p?.pid}`);
        try {
          clog("kill process");
          abortController.abort();
          p.kill("SIGTERM");
        } catch (e) {
          clog(e);
        }
        abortController = new AbortController();
        const expandDir = ensure(
          path.resolve(ensure(await fn.expand(denops, dir), is.String)),
          is.String,
        );
        clog({ cmdArgs, expandDir });

        clog(`--- asyngrep start ---`);

        p = new Deno.Command(tool.cmd, {
          args: cmdArgs,
          stdin: "null",
          stdout: "piped",
          stderr: "piped",
          cwd: expandDir,
        }).spawn();

        clog(`pid: ${p?.pid}`);
        await batch(denops, async (denops) => {
          await fn.setqflist(denops, [], " ", {
            title: `[Search results for ${pattern} on ${tool.cmd} path: ${expandDir}]`,
          });
          await denops.cmd("botright copen");
        });

        if (!p || p.stdout === null) {
          return;
        }
        for await (
          let line of abortable(
            iterLine(p.stdout),
            abortController.signal,
          )
        ) {
          clog({ line });
          line = line.trim();
          const lsp = line.split("|");
          if (!path.isAbsolute(lsp[0])) {
            const absolute = path.join(expandDir, lsp[0]);
            line = [absolute, ...lsp.slice(1, -1)].join("|");
          }
          await fn.setqflist(denops, [], "a", { lines: [line] });
        }

        clog(`--- asyngrep end ---`);

        const status = await p.status;
        if (!status.success) {
          for await (
            const line of abortable(
              iterLine(p.stderr),
              abortController.signal,
            )
          ) {
            clog({ line });
          }
        }
      } catch (e) {
        clog(e);
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
