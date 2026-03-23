import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/HomePage.vue'),
    },
    {
      path: '/filmstrip',
      name: 'filmstrip',
      component: () => import('../views/FilmStripPage.vue'),
    },
    {
      path: '/music-ball',
      name: 'music-ball',
      component: () => import('../views/MusicBallPage.vue'),
    },
    {
      path: '/splice',
      name: 'splice',
      component: () => import('../views/RippleSplicePage.vue'),
    },
    {
      path: '/intro',
      name: 'intro',
      component: () => import('../views/IntroPage.vue'),
    },
    {
      path: '/poster',
      name: 'poster',
      component: () => import('../views/PosterPage.vue'),
    },
    {
      path: '/diffusion',
      name: 'diffusion',
      component: () => import('../views/DiffusionPage.vue'),
    },
  ],
})

export default router
