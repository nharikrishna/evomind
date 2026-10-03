# EvoMind

A 2D world where creatures controlled by neural networks evolve behavior through natural selection, with no backpropagation.

We define the world and the rules of evolution. We never program how the creatures behave.

## Run
```
npm install
npm run dev
```

Other commands:
```
npm test                                     # unit tests
npm run evolve -- --gens 200 --seeds 1,2,3   # headless evolution (generational lab)
npm run evolve -- --natural --ticks 50000    # headless natural reproduction
```
