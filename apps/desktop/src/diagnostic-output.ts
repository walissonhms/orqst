// A launcher may close its diagnostic pipes while the Desktop is still alive.
// Only loss of these two output streams is optional; IPC/PTY errors stay fatal.
for (const output of [process.stdout, process.stderr]) {
  output.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE' && error.syscall === 'write') return;
    throw error;
  });
}
