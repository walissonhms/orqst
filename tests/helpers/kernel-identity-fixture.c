/* Synthetic test-only kernel query. It never reads process arguments or application state. */
#include <sys/types.h>
#include <sys/proc_info.h>
#include <sys/sysctl.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc != 2) return 1;
  pid_t pid = (pid_t)strtol(argv[1], NULL, 10);
  struct proc_bsdinfo data;
  char boot[64];
  size_t length = sizeof(boot);
  if (pid <= 0 || proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &data, sizeof(data)) != sizeof(data) ||
      sysctlbyname("kern.bootsessionuuid", boot, &length, NULL, 0) != 0 ||
      length != 37 || boot[36] != 0) return 2;
  pid_t sid = getsid(pid);
  pid_t pgid = getpgid(pid);
  if (sid <= 0 || pgid <= 0 || data.pbi_pgid != (unsigned)pgid) return 3;
  printf("{\"boot\":\"%s\",\"pid\":%u,\"ppid\":%u,\"uid\":%u,"
         "\"startSec\":%llu,\"startUsec\":%llu,\"sid\":%d,\"pgid\":%d}\n",
         boot, data.pbi_pid, data.pbi_ppid, data.pbi_uid,
         data.pbi_start_tvsec, data.pbi_start_tvusec, sid, pgid);
  return 0;
}
