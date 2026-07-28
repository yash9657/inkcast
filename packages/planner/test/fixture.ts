/** A document that exercises every beat shape the heuristic planner knows. */
export const GRADIENT_DESCENT = `# Gradient Descent

Gradient descent is an iterative optimisation algorithm that walks downhill on a
loss surface until it settles in a minimum. It is the workhorse behind almost
every trained neural network, and it is far simpler than it sounds.

## The update rule

At each step you measure the slope of the loss with respect to every parameter,
then move a small distance in the opposite direction. The size of that step is
called the learning rate, and it is the single most important knob you will tune.

1. Compute the loss on a batch of data
2. Differentiate the loss to get a gradient
3. Step the parameters downhill
4. Repeat until the loss stops improving

## Batch size matters

Full batch descent uses the whole dataset for every step, whereas stochastic
descent uses one example at a time and takes a noisy path to the same place.

The compromise almost everyone reaches for is the mini-batch, typically 32 to 512
examples per step.

## Why the learning rate is delicate

A learning rate that is too large overshoots the minimum and the loss diverges.
Too small, and training takes 10 times longer than it needs to for no benefit at
all. In practice a schedule that decays the rate by 10 percent every few epochs
converges about 3 times faster than a constant rate.

> All models are wrong, but some are useful.

## Things that go wrong

- Vanishing gradients in very deep networks
- Saddle points where the slope is almost flat
- Poorly scaled features that stretch the loss surface
- A learning rate left on its default value

## In code

\`\`\`python
for batch in loader:
    loss = model(batch).loss
    loss.backward()
    optimizer.step()
\`\`\`
`;

/** A section that opens with a definition, then adds a second thought about it. */
export const DEFINITION_DOC = `# Caching

Caching makes repeated work cheap.

## The cache

A cache is a small, fast store that keeps the answers you already computed. It
earns its keep only when the same question comes back often enough to pay for the
memory it occupies.
`;

export const PLAIN_TEXT = `Photosynthesis

Plants turn sunlight into sugar. The leaf absorbs light with chlorophyll, splits
water, and releases oxygen as a by-product.

Why it matters

Almost every calorie you eat started as a photon captured by a leaf.`;
