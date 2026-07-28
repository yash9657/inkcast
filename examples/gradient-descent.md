# Gradient descent

Almost every model you have heard of — logistic regression, a recommender, a
language model with a trillion parameters — is trained by the same stubborn
little procedure. You put a number on how wrong the model is, work out which way
is downhill, take a small step that way, and repeat. That is gradient descent,
and it is worth understanding properly because everything else in training is a
variation on it.

## The loss surface

Start with the thing being minimised. A **loss function** takes the model's
parameters and returns a single number: how badly the model did on the data.
Lower is better.

Now imagine the parameters as coordinates on a map, and the loss as the height of
the ground at each point. Two parameters give you a literal landscape with hills
and valleys. A million parameters give you the same idea in a space nobody can
picture, which is fine — the algorithm never needs to see the whole landscape.
Training means walking from wherever you happen to have started, down towards a
valley floor.

## Which way is downhill

The **gradient** is the vector of partial derivatives of the loss with respect to
each parameter. Read it as a single instruction: _this_ is the direction in which
the loss increases fastest, and this is how steeply.

So the direction you want is the opposite one. That gives the update rule, the
only equation you actually need:

    w ← w − η · ∇L(w)

Three pieces. `∇L(w)` is the gradient at your current position. The minus sign
turns "steepest uphill" into "steepest downhill". And `η`, the **learning rate**,
decides how big a step you take.

## The learning rate is the whole game

The learning rate is one number, and choosing it badly is the most common way to
waste a week of compute.

- **Too small.** Every step is a shuffle. You will get to the valley eventually,
  long after your deadline.
- **Too large.** You overshoot the bottom, land higher up the other side,
  overshoot again, and the loss climbs instead of falls. People call this
  divergence; on a graph it looks like a curve that turns around and leaves.
- **About right.** The loss drops steeply at first, then flattens as the slope
  under you gets gentler. That flattening is not the algorithm giving up — it is
  what approaching a minimum looks like.

In practice nobody keeps `η` fixed. You start larger to cover ground and decay it
over training so the last steps are careful.

## Why nobody uses the whole dataset

Computing the true gradient means evaluating every training example before taking
a single step. On a large dataset that is one step per hour.

**Stochastic gradient descent** cheats: estimate the gradient from a small random
batch, take the step immediately, move on. Each estimate is noisy and points
slightly the wrong way. It does not matter, because you now take thousands of
approximate steps in the time one exact step would have cost — and the noise
turns out to help, jostling the parameters out of shallow dips they would
otherwise settle into.

**Momentum** goes further. Instead of stepping along the current gradient alone,
keep a running average of recent gradients and step along that. A ball rolling
downhill does the same thing: it builds speed in the consistent direction and
ignores the side-to-side chatter. Optimisers like Adam add a second trick,
scaling each parameter's step by how noisy that parameter's gradient has recently
been, which is why they need so little tuning.

## What can go wrong

- **Plateaus.** Wide flat regions where the gradient is nearly zero, so the steps
  become nearly nothing. Momentum is what carries you across.
- **Saddle points.** Downhill in one direction, uphill in another. In high
  dimensions these are far more common than true local minima, and noise plus
  momentum usually escapes them.
- **Bad scaling.** If one parameter's axis is stretched relative to another, the
  path zigzags down a narrow valley instead of running along it. This is why
  inputs get normalised before training starts.

## What to remember

Gradient descent is not clever. It is one loop — measure the error, find the
slope, step downhill, repeat — that scales to models with billions of parameters
precisely _because_ it is so simple. Every optimiser you will meet is that loop
with a better answer to one question: how big should the next step be, and in
what direction?
