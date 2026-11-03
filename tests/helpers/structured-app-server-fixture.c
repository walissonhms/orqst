/* SYNTHETIC app-server only: no provider, network, credentials, subprocesses or external files. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void record(const char *method) {
  char path[4096];
  snprintf(path, sizeof(path), "%s/SYNTHETIC-methods.log", getenv("TMPDIR"));
  FILE *file = fopen(path, "a");
  if (!file) exit(31);
  fprintf(file, "%s\n", method);
  fclose(file);
}

int main(void) {
  alarm(12); /* Independent disposable-child deadline, including after IPC disconnect. */
  setbuf(stdout, NULL);
  fputs("SYNTHETIC-SECRET-STDERR-CREDENTIAL\n", stderr);
  char cwd[4096];
  if (!getcwd(cwd, sizeof(cwd))) return 32;
  const char *mode = strrchr(cwd, '/');
  if (!mode) return 33;
  mode++;
  if (!strcmp(mode, "silent")) { sleep(9); return 0; }

  char *line = NULL;
  size_t capacity = 0;
  while (getline(&line, &capacity, stdin) > 0) {
    if (strlen(line) > 4096) return 34;
    const char *method = strstr(line, "\"method\":\"");
    if (!method) return 35;
    method += strlen("\"method\":\"");
    char name[64];
    size_t length = strcspn(method, "\"");
    if (length >= sizeof(name)) return 36;
    memcpy(name, method, length); name[length] = 0;
    /* Never record payloads. Reject any inference or unrecognized operation. */
    if (strcmp(name, "initialize") && strcmp(name, "initialized") &&
        strcmp(name, "account/read") && strcmp(name, "thread/start")) return 37;
    record(name);
    if (!strcmp(name, "initialized")) continue;
    const char *start = strstr(line, "\"id\":\"");
    if (!start) return 38;
    start += strlen("\"id\":\"");
    char id[129];
    length = strcspn(start, "\"");
    if (!length || length >= sizeof(id)) return 39;
    memcpy(id, start, length); id[length] = 0;
    if (!strcmp(name, "initialize")) {
      if (!strcmp(mode, "delayed-initialize")) sleep(9);
      if (!strcmp(mode, "events-only")) {
        puts("{\"method\":\"SYNTHETIC/startup\",\"params\":{}}");
        sleep(9); return 0;
      }
      char response[1024];
      snprintf(response, sizeof(response),
        "{\"id\":\"%s\",\"result\":{\"userAgent\":\"SYNTHETIC-💠\","
        "\"platformFamily\":\"unix\",\"platformOs\":\"macos\","
        "\"codexHome\":\"/SYNTHETIC-NOT-READ\"}}", id);
      if (!strcmp(mode, "unterminated")) {
        fputs(response, stdout); sleep(9); return 0;
      }
      if (!strcmp(mode, "content-length")) {
        printf("Content-Length: %zu\r\n\r\n%s", strlen(response), response);
        usleep(250000); return 0;
      }
      if (!strcmp(mode, "rejected")) {
        printf("{\"id\":\"%s\",\"error\":{\"code\":-32602,"
          "\"message\":\"SYNTHETIC-SECRET-MUST-NOT-LEAK\"}}\n", id);
        usleep(250000); return 0;
      }
      /* Notification larger than a host IPC slice; followed by fragmented UTF-8 JSONL. */
      fputs("{\"method\":\"SYNTHETIC/startup\",\"params\":\"", stdout);
      for (int i = 0; i < 96 * 1024; i++) putchar('x');
      fputs("\"}\r\n", stdout);
      for (size_t i = 0; i < strlen(response); i++) {
        putchar(response[i]);
        if ((unsigned char)response[i] >= 128) usleep(1000);
      }
      fputs("\r\n", stdout);
    } else if (!strcmp(name, "account/read")) {
      printf("{\"id\":\"%s\",\"result\":{\"account\":{\"type\":\"chatgpt\","
        "\"email\":\"SYNTHETIC-SECRET-MUST-NOT-LEAK\"}}}\n", id);
    } else {
      printf("{\"method\":\"thread/started\",\"params\":{\"thread\":{\"id\":\"SYNTHETIC-thread-%d\"}}}\n"
        "{\"id\":\"%s\",\"result\":{\"thread\":{\"id\":\"SYNTHETIC-thread-%d\",\"ephemeral\":true},"
        "\"model\":\"SYNTHETIC-model\",\"sandbox\":{\"type\":\"readOnly\"},"
        "\"approvalPolicy\":\"on-request\"}}\n", getpid(), id, getpid());
    }
  }
  free(line);
  return 0;
}
