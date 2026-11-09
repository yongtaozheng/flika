import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/transition/diffusion',
    },
    {
      path: '/transition',
      component: () => import('../views/BeatTransitionLayout.vue'),
      redirect: '/transition/diffusion',
      children: [
        {
          path: ':removedEffect(beam|kaleidoscope|palette)',
          redirect: '/transition/diffusion',
        },
        {
          path: 'diffusion',
          name: 'diffusion',
          component: () => import('../views/DiffusionPage.vue'),
        },
        {
          path: 'beat',
          name: 'beat',
          component: () => import('../views/HomePage.vue'),
        },
        {
          path: 'splice',
          name: 'splice',
          component: () => import('../views/RippleSplicePage.vue'),
        },
        {
          path: 'ink',
          name: 'ink',
          component: () => import('../views/InkRenderPage.vue'),
        },
        {
          path: 'collage',
          name: 'collage',
          component: () => import('../views/FragmentCollagePage.vue'),
        },
        {
          path: 'waterfall',
          name: 'waterfall',
          component: () => import('../views/PixelWaterfallPage.vue'),
        },
        {
          path: 'particle',
          name: 'particle',
          component: () => import('../views/ParticleReformPage.vue'),
        },
        {
          path: 'raindrop',
          name: 'raindrop',
          component: () => import('../views/RaindropErosionPage.vue'),
        },
      ],
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
      path: '/intro',
      name: 'intro',
      component: () => import('../views/IntroPage.vue'),
    },
    {
      path: '/poster',
      name: 'poster',
      component: () => import('../views/PosterPage.vue'),
    },
  ],
})

export default router
