/* SYNTHETIC structured Desktop fixture: no provider, credentials, network or descendants. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static char thread[80];
static int root = 0;
static void emit(const char *method, const char *params) {
  printf("{\"method\":\"%s\",\"params\":%s}\n", method, params);
}
static void complete(const char *text) {
  char params[1024];
  snprintf(params, sizeof(params),
    "{\"threadId\":\"%s\",\"turnId\":\"SYNTHETIC-turn\",\"item\":{"
    "\"id\":\"SYNTHETIC-message\",\"type\":\"agentMessage\",\"phase\":\"final_answer\",\"text\":\"%s\"}}", thread, text);
  emit("item/completed", params);
  snprintf(params, sizeof(params), "{\"threadId\":\"%s\",\"turn\":{\"id\":\"SYNTHETIC-turn\",\"status\":\"completed\"}}", thread);
  emit("turn/completed", params);
}
int main(void) {
  alarm(90); /* Independent bound, even when the parent loses its channel. */
  setbuf(stdout, NULL);
  snprintf(thread, sizeof(thread), "SYNTHETIC-thread-%d", getpid());
  char *line = NULL;
  size_t capacity = 0;
  while (getline(&line, &capacity, stdin) > 0) {
    if (strlen(line) > 16384) return 31;
    const char *method = strstr(line, "\"method\":\"");
    if (!method) {
      if (!root || !strstr(line, "\"id\":\"SYNTHETIC-call\"") || !strstr(line, "SYNTHETIC worker result")) return 32;
      printf("{\"method\":\"item/completed\",\"params\":{\"threadId\":\"%s\",\"turnId\":\"SYNTHETIC-turn\",\"item\":{\"id\":\"SYNTHETIC-call\",\"type\":\"dynamicToolCall\",\"tool\":\"orqst_delegate_task\",\"status\":\"completed\",\"success\":true}}}\n", thread);
      complete("SYNTHETIC root received worker result");
      continue;
    }
    method += strlen("\"method\":\"");
    char name[64];
    size_t length = strcspn(method, "\"");
    if (length >= sizeof(name)) return 33;
    memcpy(name, method, length); name[length] = 0;
    if (!strcmp(name, "initialized")) continue;
    const char *start = strstr(line, "\"id\":\"");
    if (!start) return 34;
    start += strlen("\"id\":\"");
    char id[129];
    length = strcspn(start, "\"");
    if (!length || length >= sizeof(id)) return 35;
    memcpy(id, start, length); id[length] = 0;
    if (!strcmp(name, "initialize")) printf("{\"id\":\"%s\",\"result\":{}}\n", id);
    else if (!strcmp(name, "account/read"))
      printf("{\"id\":\"%s\",\"result\":{\"account\":{\"type\":\"chatgpt\"}}}\n", id);
    else if (!strcmp(name, "thread/start")) {
      root = strstr(line, "\"dynamicTools\"") != NULL;
      printf("{\"id\":\"%s\",\"result\":{\"thread\":{\"id\":\"%s\",\"ephemeral\":true},"
        "\"model\":\"SYNTHETIC-model\",\"sandbox\":{\"type\":\"readOnly\"},\"approvalPolicy\":\"on-request\"}}\n", id, thread);
    } else if (!strcmp(name, "turn/start")) {
      printf("{\"id\":\"%s\",\"result\":{\"turn\":{\"id\":\"SYNTHETIC-turn\",\"status\":\"inProgress\"}}}\n", id);
      char params[1024];
      snprintf(params, sizeof(params), "{\"threadId\":\"%s\",\"turn\":{\"id\":\"SYNTHETIC-turn\",\"status\":\"inProgress\"}}", thread);
      emit("turn/started", params);
      if (root) {
        const char *target = strstr(line, "targetPaneId \\\"");
        if (!target) return 36;
        target += strlen("targetPaneId \\\"");
        length = strcspn(target, "\\");
        if (!length || length > 128) return 37;
        char pane[129]; memcpy(pane, target, length); pane[length] = 0;
        printf("{\"id\":\"SYNTHETIC-call\",\"method\":\"item/tool/call\",\"params\":{"
          "\"threadId\":\"%s\",\"turnId\":\"SYNTHETIC-turn\",\"callId\":\"SYNTHETIC-call\","
          "\"namespace\":null,\"tool\":\"orqst_delegate_task\",\"arguments\":{\"targetPaneId\":\"%s\",\"task\":\"SYNTHETIC worker task\"}}}\n", thread, pane);
      } else complete("SYNTHETIC worker result");
    } else return 38;
  }
  free(line);
  return 0;
}
