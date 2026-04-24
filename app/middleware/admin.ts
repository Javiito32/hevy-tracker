export default defineNuxtRouteMiddleware(() => {
  const { session } = useUserSession()
  if ((session.value?.user as any)?.role !== 'admin') {
    return navigateTo('/')
  }
})
