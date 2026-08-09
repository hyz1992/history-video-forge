#!/usr/bin/env python3
"""
StoryForge 本地开发一键启动脚本。

功能概览：
1. 并行启动后端和前端开发服务
2. 将两路日志按来源打前缀，便于区分
3. 支持 Ctrl+C 一次性优雅停止所有子进程
4. 默认执行数据库准备流程（Prisma generate + migrate deploy）
"""

from __future__ import annotations

import argparse
import os
import signal
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Iterable, TextIO


def build_commands() -> list[tuple[str, list[str]]]:
    """返回要启动的服务命令列表（名称 + 命令数组）。"""
    return [
        ("backend", ["npm", "run", "dev:backend"]),
        ("frontend", ["npm", "run", "dev:frontend"]),
    ]


def build_prepare_commands() -> list[list[str]]:
    """返回数据库准备命令列表，按顺序执行。"""
    return [
        ["npx", "prisma", "generate"],
        ["npx", "prisma", "migrate", "deploy"],
    ]


def resolve_executable(executable: str, os_name: str | None = None) -> str:
    """
    解析可执行文件绝对路径，避免 Windows 下 `npm` / `npx` 裸命令找不到的问题。

    说明：
    - 在 Windows 下，优先尝试 `<name>.cmd`，因为 npm/npx 常以 .cmd 存在
    - 在其他平台下，按原名查找即可
    """
    platform_name = os_name or os.name
    candidates = [executable]
    if platform_name == "nt" and "." not in Path(executable).name:
        candidates.extend([f"{executable}.cmd", f"{executable}.exe"])

    for candidate in candidates:
        found = shutil.which(candidate)
        if found:
            return found

    raise FileNotFoundError(f"Executable not found in PATH: {executable}")


def resolve_command(command: list[str], os_name: str | None = None) -> list[str]:
    """将命令首 token 解析为可执行路径，其余参数保持不变。"""
    if not command:
        return command
    resolved_exec = resolve_executable(command[0], os_name=os_name)
    return [resolved_exec, *command[1:]]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(
        description="Start StoryForge backend and frontend for local development."
    )
    database_group = parser.add_mutually_exclusive_group()
    database_group.add_argument(
        "--prepare-db",
        dest="prepare_db",
        action="store_true",
        help="Prepare the database before startup (default; retained for compatibility).",
    )
    database_group.add_argument(
        "--skip-db-prepare",
        dest="prepare_db",
        action="store_false",
        help="Skip Prisma Client generation and pending database migrations.",
    )
    parser.set_defaults(prepare_db=True)
    return parser.parse_args(argv)


def prepare_database(repo_root: Path) -> int:
    """
    在 backend 目录执行 Prisma 相关命令。

    约定：
    - 任意一步失败即停止并返回对应错误码
    - 成功返回 0
    """
    backend_dir = repo_root / "backend"
    print("[system] preparing database (prisma generate + prisma migrate deploy)...")
    for cmd in build_prepare_commands():
        resolved_cmd = resolve_command(cmd)
        print(f"[system] running in backend: {' '.join(cmd)}")
        try:
            result = subprocess.run(resolved_cmd, cwd=str(backend_dir), check=False)
        except FileNotFoundError:
            print("[system] npx not found in PATH. Please install Node.js and npm first.", file=sys.stderr)
            return 1
        if result.returncode != 0:
            print(f"[system] command failed ({result.returncode}): {' '.join(cmd)}", file=sys.stderr)
            return result.returncode
    print("[system] database preparation completed.")
    return 0


def get_process_group_id(pid: int) -> int:
    """
    获取进程组 ID。

    在不支持 getpgid 的平台上，退化为返回 pid 本身（便于统一调用）。
    """
    getter = getattr(os, "getpgid", None)
    if getter is None:
        return pid
    return getter(pid)


def kill_process_group(pgid: int, sig: int) -> None:
    """
    向进程组发送信号（POSIX 优先策略）。

    Windows 默认没有 killpg，这里显式抛错让上层走兜底逻辑。
    """
    killer = getattr(os, "killpg", None)
    if killer is None:
        raise OSError("killpg is not available on this platform")
    killer(pgid, sig)


def terminate_process(proc: subprocess.Popen[str], os_name: str | None = None) -> None:
    """
    尝试优雅停止子进程，必要时强制 kill。

    处理策略：
    - Windows：优先发 CTRL_BREAK_EVENT（触发进程组中断），失败则 terminate
    - POSIX：优先给进程组发 SIGTERM，失败则 terminate
    - 两者都包含超时等待与 kill 兜底
    """
    platform_name = os_name or os.name
    # 已退出则无需处理，避免重复停止带来的噪音
    if proc.poll() is not None:
        return

    try:
        if platform_name == "nt":
            ctrl_break = getattr(signal, "CTRL_BREAK_EVENT", signal.SIGTERM)
            try:
                proc.send_signal(ctrl_break)
            except Exception:
                proc.terminate()
        else:
            pgid = get_process_group_id(proc.pid)
            kill_process_group(pgid, signal.SIGTERM)
    except Exception:
        proc.terminate()

    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def _stream_output(name: str, stream: TextIO) -> None:
    """持续读取子进程输出，并附加来源前缀。"""
    for line in iter(stream.readline, ""):
        print(f"[{name}] {line}", end="")


def _spawn_process(name: str, command: list[str], cwd: Path) -> subprocess.Popen[str]:
    """
    启动单个子进程。

    关键点：
    - stdout/stderr 合并，统一前缀输出
    - 文本模式 + 行缓冲，保证日志可读性
    - Windows/POSIX 分别创建独立进程组/会话，便于后续统一停止
    """
    env = os.environ.copy()
    env["FORCE_COLOR"] = "0"
    env["NO_COLOR"] = "1"

    kwargs: dict = {
        "cwd": str(cwd),
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "encoding": "utf-8",
        "errors": "replace",
        "bufsize": 1,
        "env": env,
    }

    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        kwargs["start_new_session"] = True

    resolved_command = resolve_command(command)
    process = subprocess.Popen(resolved_command, **kwargs)
    print(f"[system] started {name}: {' '.join(command)}")
    return process


def _stop_all(processes: Iterable[subprocess.Popen[str]]) -> None:
    """停止所有已启动的子进程。"""
    for proc in processes:
        terminate_process(proc)


def run(prepare_db: bool = False) -> int:
    """
    主流程入口。

    执行顺序：
    1. （可选）准备数据库
    2. 启动后端和前端
    3. 监听退出条件（任一进程退出或收到 Ctrl+C）
    4. 统一回收子进程并返回退出码
    """
    repo_root = Path(__file__).resolve().parent
    if prepare_db:
        code = prepare_database(repo_root)
        if code != 0:
            return code

    print("[system] starting backend and frontend...")

    processes: dict[str, subprocess.Popen[str]] = {}
    threads: list[threading.Thread] = []
    # 线程安全的“停止请求”标志，用于协调主循环和信号处理器
    stop_requested = threading.Event()

    def request_stop(_sig=None, _frame=None) -> None:
        """信号处理器：只设置停止标志，不直接做重操作。"""
        if not stop_requested.is_set():
            print("\n[system] shutdown requested, stopping child processes...")
        stop_requested.set()

    signal.signal(signal.SIGINT, request_stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, request_stop)

    try:
        for name, command in build_commands():
            proc = _spawn_process(name, command, repo_root)
            processes[name] = proc
            if proc.stdout is None:
                continue
            t = threading.Thread(target=_stream_output, args=(name, proc.stdout), daemon=True)
            t.start()
            threads.append(t)
    except FileNotFoundError:
        print("[system] npm not found in PATH. Please install Node.js and npm first.", file=sys.stderr)
        request_stop()
    except Exception as exc:
        print(f"[system] failed to start services: {exc}", file=sys.stderr)
        request_stop()

    exit_code = 0
    try:
        # 轮询子进程状态：
        # - 任一进程退出 -> 触发整体停止
        # - 若是非 0 退出码，记录为本次脚本退出码
        while not stop_requested.is_set():
            for name, proc in processes.items():
                code = proc.poll()
                if code is None:
                    continue
                print(f"[system] {name} exited with code {code}")
                if code != 0 and exit_code == 0:
                    exit_code = code
                stop_requested.set()
                break
            time.sleep(0.2)
    finally:
        # 无论正常退出还是异常，都确保子进程和输出线程被回收
        _stop_all(processes.values())
        for t in threads:
            t.join(timeout=1)
        print("[system] all services stopped.")

    return exit_code


def main(argv: list[str] | None = None) -> None:
    """CLI 入口：解析参数并返回对应退出码。"""
    args = parse_args(argv)
    raise SystemExit(run(prepare_db=args.prepare_db))


if __name__ == "__main__":
    main()
