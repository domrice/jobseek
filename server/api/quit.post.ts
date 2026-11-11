// The Exit button. A local single-user app started from a Dock icon needs a way to stop that is not
// "find the Terminal window and press Ctrl-C".
//
// ponytail: kills the parent too, because in `nuxt dev` this handler runs in a child that the dev
// server would simply restart — SIGTERM to the parent takes the whole `npm run dev` tree down.
// Ceiling: assumes the parent is ours, which it is for every documented way of starting this app
// (start.command, npm run dev, npm run preview). Upgrade path: none; it is a localhost-only app.
export default defineEventHandler(event => {
  // Respond first: the browser should see 200, not a dropped socket.
  event.node.res.on('finish', () => {
    setTimeout(() => {
      try {
        process.kill(process.ppid, 'SIGTERM')
      } catch {}
      process.exit(0)
    }, 100)
  })
})
