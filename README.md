# dps-asyngrep

[非同期に Grep 検索する (denops.vim)](https://zenn.dev/yukimemi/articles/2021-03-21-dps-asyngrep)

[![asciicast](https://asciinema.org/a/JFQPdITg4is48RwQLpcTLTIJv.svg)](https://asciinema.org/a/JFQPdITg4is48RwQLpcTLTIJv)

## Example config.

```vim
" Debug log option.
let g:asyngrep_debug = v:false
" User config (not necessary)
let g:asyngrep_cfg_path = "~/.vim/asyngrep.toml"

" Grep with default tool.
nnoremap <space>ss <cmd>Agp<cr>

" Grep with ripgrep.
nnoremap <space>sr <cmd>Agp --tool=ripgrep<cr>
" Grep with pt.
nnoremap <space>sp <cmd>Agp --tool=pt<cr>
" Grep with jvgrep.
nnoremap <space>sj <cmd>Agp --tool=jvgrep<cr>
```

## Example toml config.

- `g:asyngrep_cfg_path` toml file.

```toml
[[tool]]
name = "ripgrep-all"
cmd = "rg"
arg = ["-i", "--vimgrep", "--no-heading", "--hidden", "--no-ignore", "--regexp"]
# Agp --tool=ripgrep-all

[[tool]]
name = "jvgrep-all"
cmd = "jvgrep"
arg = ["-i", "--no-color", "-I", "-R", "-8"]
# Agp --tool=jvgrep-all

[[tool]]
name = "pt-all"
cmd = "pt"
arg = ["-i", "--nogroup", "--nocolor", "--smart-case", "--skip-vcs-ignores", "--hidden"]
# Agp --tool=pt-all

[[tool]]
name = "default"
cmd = "pt"
arg = ["-i", "--nogroup", "--nocolor"]
# Agp
```

## Default config.

```toml
[[tool]]
name = "ripgrep"
cmd = "rg"
arg = ["-i", "--vimgrep", "--no-heading"]

[[tool]]
name = "jvgrep"
cmd = "jvgrep"
arg = ["-i", "--no-color", "-I", "-R", "-8"]

[[tool]]
name = "pt"
cmd = "pt"
arg = ["-i", "--nogroup", "--nocolor"]
```
