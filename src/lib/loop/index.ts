// Public API of the learning-loop math.

export {
  type ArmPosterior,
  betaPdfPoints,
  creativePosteriors,
  dimensionPosteriors,
} from './posteriors';
export {
  makeThompsonAllocator,
  sampleBeta,
  sampleGamma,
  samplePriors,
  type ThompsonOpts,
} from './thompson';
export {
  compareGenerations,
  type GenerationComparison,
  type GenerationVerdict,
  type Interval,
  wilsonInterval,
} from './wilson';
export {
  extractLearnings,
  type LearningOpts,
  retirementDecisions,
  type RetirementOpts,
} from './learnings';
export {
  type ComparisonDay,
  type ComparisonResult,
  runComparison,
} from './compare';
