/* Synthetic direct child: no provider, credentials, network, descendants or user files. */
#include <signal.h>
#include <fcntl.h>
#include <unistd.h>
int main(void) {
  if (fcntl(4, F_GETFD) != -1) return 37;
  usleep(1000000);
  raise(SIGTERM);
  return 19;
}
