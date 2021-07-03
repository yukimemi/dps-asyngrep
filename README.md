# dps-asyngrep

[非同期に Grep 検索する (denops.vim)](https://zenn.dev/yukimemi/articles/2021-03-21-dps-asyngrep)

```vim
let g:asyngrep_debug = v:false
let g:asyngrep_cfg_path = $VIM_PATH . "/asyngrep.toml"

nnoremap <space>ss <cmd>Agp<cr>
nnoremap <space>sr <cmd>Agp --tool=ripgrep<cr>
nnoremap <space>sp <cmd>Agp --tool=pt<cr>
nnoremap <space>sj <cmd>Agp --tool=jvgrep<cr>

```
