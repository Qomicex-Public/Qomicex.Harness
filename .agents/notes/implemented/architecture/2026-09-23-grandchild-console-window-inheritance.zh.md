# 智能体笔记：孙进程控制台窗口的继承

状态：已实现

[English](2026-09-23-grandchild-console-window-inheritance.md) | 中文

## 问题

打包的桌面宿主机通过 Windows Job runner 运行 `pwsh -Command …`，而每次 spawn 本已抑制自身窗口：runner 以 `windowsHide` 启动，并通过 `spawnCurrentTokenJobProcess` 创建 target 时传入 `CREATE_NO_WINDOW`。但运行会再启动一个 console 进程的命令——例如 `ping`——仍然会打开一个可见的控制台窗口，并阻塞该工具调用直到窗口关闭。

`CREATE_NO_WINDOW` 是创建标志。创建标志只作用于被创建的进程，不作用于其他进程，因此无法传递给孙进程。无窗口创建的 target 自身完全没有控制台。当 target 自己的 console 模式子进程启动时，父进程链没有任何控制台可给予它，于是系统为孙进程分配一个全新的控制台——即一个可见窗口。孙进程退出时窗口随之关闭，这就是工具调用直到窗口关闭才返回的原因。

## 决策

Windows runner 在创建 target 前先建立自己的控制台并隐藏其窗口，target 以 `inherit` 控制台模式创建：`ensureHiddenConsole()` 调用 `AllocConsole`（幂等——已存在控制台时报拒绝访问，这正是期望结果），并立即对控制台窗口 `ShowWindow(…, SW_HIDE)`。`spawnCurrentTokenJobProcess` 接受 `console` 选项：默认 `hidden` 为叶子命令保留 `CREATE_NO_WINDOW`，`inherit` 则省略该标志，使 target 及其后创建的每个 console 进程共享 runner 的隐藏控制台，而不是让系统分配新控制台。

子进程服务不新增接缝：`SpawnRunnerInternals` 本就承载协议 owner 测试注入的原生操作，因此 `ensureHiddenConsole` 沿用同一接缝，测试断言执行顺序——路径查找未命中时在控制台建立前失败，成功启动时用已加载的绑定恰好建立一次控制台。

## 考虑过的替代方案

- **给孙进程传标志。** 创建标志是每个进程 CreateProcess 的输入，没有跨进程继承机制，无法延伸到后代进程。
- **包装 console 模式命令。** 执行器接受任意命令文本；包装已知肇事者（ping、nslookup、tracert）会留下无界的未覆盖孙进程集合。
- **`CREATE_NEW_CONSOLE` 加隐藏窗口。** 该标志仍会分配控制台；隐藏窗口是另一场竞态，且每个后代都会拥有自己的控制台而非共享一个。
- **在宿主进程而非 runner 中建立控制台。** 宿主可能是带有用户可见控制台的 CLI，或其全局进程状态不应改变的打包桌面应用；一次性 runner 是最窄的所有者。

## 后果

每次 Windows 普通启动为每个 runner 付一次 `AllocConsole`——每次 spawn 一个瞬态进程——runner 在其生命周期内持有隐藏控制台。Job、stdio carrier 与终止行为不变；控制台只是显示载体。

两条路径在本修复之外，记录为待办：Win32 Job 能力探测失败时使用的 `fallback` spawn，以及不经 runner 直接 spawn 的桌面宿主机。两者本已隐藏自身窗口；其背后的孙进程仍可能分配控制台窗口。`ensureHiddenConsole` 调查期间顺带审计了 pwsh 的编码 preamble，确认其已将输出固定为 UTF-8（在 pwsh 7.6.6 与 Windows PowerShell 5.1 上实测通过），未做改动。
