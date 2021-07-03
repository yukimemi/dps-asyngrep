import { _, Denops, execute, flags, fs, io, path, toml, vars } from "./deps.ts";

type Tool = {
  name: string;
  cmd: string;
  arg: string[];
};

export async function main(denops: Denops): Promise<void> {
  // debug.
  const debug = await vars.g.get(denops, "asyngrep_debug", false);
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
  const userToml = (await denops.call(
    "expand",
    (await vars.g.get(
      denops,
      "asyngrep_cfg_path",
      "~/.asyngrep.toml",
    )) as string,
  )) as string;
  clog(`g:asyngrep_cfg_path = ${userToml}`);
  if (await fs.exists(userToml)) {
    clog(`Merge user config: ${userToml}`);
    cfg = {
      tool: [
        ...(cfg.tool as Tool[]),
        ...(toml.parse(await Deno.readTextFile(userToml)).tool as Tool[]),
      ],
    };
  }

  cfg = cfg as Record<string, Tool[]>;

  clog({ cfg });

  // Set default name.
  const tools = cfg.tool as Tool[];
  const executable = tools.find(
    async (x) => (await denops.call("executable", x.cmd)) as boolean,
  );
  const def = tools.find((x) => x.name === "default") ?? executable;
  clog({ def });

  let p: Deno.Process;

  denops.dispatcher = {
    async asyngrep(...args: unknown[]): Promise<void> {
      clog({ args });
      const arg = args as string[];
      const a = flags.parse(arg);
      const pattern = a._.length > 0
        ? a._.join(" ")
        : await denops.call("input", "Search for pattern: ");
      const tool = a.tool ? tools.find((x) => x.name === a.tool) : def;
      clog({ pattern });
      clog({ tool });
      if (!tool) {
        console.warn(`Grep tool is not found !`);
        return;
      }
      const userArg = arg.filter(
        (x) => ![...a._, `--tool=${tool.name}`].includes(x),
      );
      clog({ userArg });

      const toolArg = _.uniq([...tool.arg, ...userArg].filter((x) => x));
      const cwd = (await denops.call("getcwd")) as string;
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
      await denops.call("setqflist", [], "r");
      await denops.call("setqflist", [], "a", {
        title: `[Search results for ${pattern} on ${tool.cmd}]`,
      });
      await denops.cmd("botright copen");

      if (p.stdout === null) {
        return;
      }
      for await (const line of io.readLines(p.stdout)) {
        clog({ line });
        await denops.call("setqflist", [], "a", { lines: [line] });
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
    },
  };

  await execute(
    denops,
    `
    command! -nargs=* Agp call denops#notify('${denops.name}', 'asyngrep', [<f-args>])
  `,
  );

  clog("dps-asyngrep has loaded");
}
