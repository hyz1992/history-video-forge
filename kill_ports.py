import platform
import subprocess
import sys

PORTS_TO_KILL = [3000, 5173, 5174, 5175, 5176]


def run(command: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, shell=True, capture_output=True, text=True)


def kill_port_windows(port: int) -> None:
    result = run(f"netstat -ano | findstr :{port}")
    if not result.stdout.strip():
        print(f"[windows] port {port} is free")
        return

    killed_pids: set[str] = set()
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue

        local_address = parts[1]
        pid = parts[-1]
        if not local_address.endswith(f":{port}") or pid == "0" or pid in killed_pids:
            continue

        kill_result = run(f"taskkill /F /PID {pid}")
        if kill_result.returncode == 0:
          print(f"[windows] killed pid {pid} on port {port}")
          killed_pids.add(pid)
        else:
          print(f"[windows] failed to kill pid {pid} on port {port}")
          if kill_result.stderr:
              print(kill_result.stderr.strip())


def kill_port_posix(port: int) -> None:
    result = run(f"lsof -i tcp:{port} -sTCP:LISTEN -t")
    pids = [pid for pid in result.stdout.splitlines() if pid]

    if not pids:
        print(f"[posix] port {port} is free")
        return

    for pid in pids:
        kill_result = run(f"kill -9 {pid}")
        if kill_result.returncode == 0:
            print(f"[posix] killed pid {pid} on port {port}")
        else:
            print(f"[posix] failed to kill pid {pid} on port {port}")
            if kill_result.stderr:
                print(kill_result.stderr.strip())


def main() -> int:
    system_name = platform.system().lower()

    for port in PORTS_TO_KILL:
        if system_name == "windows":
            kill_port_windows(port)
        elif system_name in {"darwin", "linux"}:
            kill_port_posix(port)
        else:
            print(f"unsupported platform: {system_name}")
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
