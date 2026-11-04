/* Disposable native PTY fixture. Not a provider and never linked into the application. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <sys/stat.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <unistd.h>

int main(int argc, char **argv) {
#ifndef ORQST_SYNTHETIC_TIMEOUT_SECONDS
#define ORQST_SYNTHETIC_TIMEOUT_SECONDS 25
#endif
  alarm(ORQST_SYNTHETIC_TIMEOUT_SECONDS);
  setbuf(stdout, NULL);
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "login") == 0) {
      char file[4096];
      snprintf(file, sizeof(file), "%s/auth.json", getenv("CODEX_HOME"));
      FILE *out = fopen(file, "w");
      if (!out) return 4;
      fputs("{\"synthetic\":true}", out);
      fclose(out);
      chmod(file, 0600);
      puts("SYNTHETIC:LOGIN_ONLY");
      return 0;
    }
  }
  if (getenv("OPENAI_API_KEY") || getenv("NODE_OPTIONS") || getenv("SSH_AUTH_SOCK")) return 5;
  struct termios raw;
  tcgetattr(0, &raw);
  raw.c_lflag &= ~(ICANON | ECHO | ISIG);
  tcsetattr(0, TCSANOW, &raw);
  printf("\033[2J\033[HSYNTHETIC:OWNED_TUI\r\n");
  printf("\033]52;c;U1lOVEhFVElD\007\033]0;UNTRUSTED_TITLE\007\033[6n");
  printf("<script>window.syntheticInjection=true</script>\r\n");
  char line[4096];
  size_t offset = 0;
  char c;
  while (read(0, &c, 1) == 1) {
    if (c == 3) { puts("SYNTHETIC:CTRL_C_BYTES"); continue; }
    if (offset < sizeof(line) - 1) line[offset++] = c;
    if (c == 'R' && offset > 1 && line[0] == 27) { puts("SYNTHETIC:UNEXPECTED_AUTO_REPLY"); offset = 0; }
    if (c != '\n' && c != '\r') continue;
    line[offset] = 0;
    if (strncmp(line, "ping", 4) == 0) puts("SYNTHETIC:PONG");
    if (strncmp(line, "size", 4) == 0) {
      struct winsize size;
      ioctl(0, TIOCGWINSZ, &size);
      printf("SYNTHETIC:SIZE:%dx%d\r\n", size.ws_col, size.ws_row);
    }
    if (strncmp(line, "flood", 5) == 0) {
      for (int i = 0; i < 8192; i++) puts("SYNTHETIC:BOUNDED-OUTPUT-012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789");
    }
    if (strncmp(line, "exit", 4) == 0) return 0;
    offset = 0;
  }
  return 0;
}
