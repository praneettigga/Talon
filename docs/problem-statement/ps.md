# HNX26PSI04: Real-Time Financial Fraud Intelligence

**FinTech · Graph ML · Anomaly Detection · AI**

## What You're Building

Fraud doesn't always hide in one suspicious transaction — it hides in patterns across many accounts, devices, stores, and payment channels.

Build a system that learns normal behavior, spots when something is off, and finds coordinated fraud rings.

Your output should show:

- Risk score for each transaction
- Risk score for each account
- Which accounts are suspicious together
- What pattern you found
- A diagram showing connections
- What action to take

### Example

Ten accounts from different people, different locations, different devices — but they all buy the same unusual items in the same sequence, then move money to the same place.

No single transaction looks bad.

The pattern says fraud.

## Key Rules

- **False positive limit:** If you flag too many legitimate transactions as fraud, your score gets capped. Precision matters.
- **Every risk score must have an explanation.** A score with no reasoning = no evidence points.

## How You'll Be Judged

- Can it find fraud rings (multiple accounts acting together)?
- Does it catch fraud without false alarms?
- Does it catch most of the real fraud?
- Does it rank transactions and accounts by risk correctly?
- Does it avoid flagging legitimate high-value transactions?
- Can it spot unusual behavior compared to normal?
- Does it explain why something looks like fraud?

## What to Build First

- Create or find transaction data (IEEE fraud dataset, Kaggle datasets, or simulate your own)
- Start by detecting one fraud ring in the network
- **Advanced:** Handle new patterns and accounts that change behavior




# Common Submission Guidelines

Regardless of the problem statement chosen, the submission must demonstrate a working solution and clearly explain how it was built.

The submission should include:

- **Working System** – A functional solution that addresses the chosen problem.
- **Source Code** – A Git repository containing the complete source code and a clear README with instructions to set up and run the system end-to-end.
- **Data Pipeline** – A clear demonstration of how input data is collected, processed, and passed through the system.
- **Core Model / Reasoning** – The central logic, model, or reasoning mechanism that powers the solution.
- **Evidence & Explanation** – Supporting evidence that demonstrates how the system works, such as:
  - Citations
  - Timestamps
  - Confidence scores
  - Intermediate outputs
  - Relevant code
- **Sample Input & Output** – At least one representative example showing the system working from input to output.
- **Scope Note** – Clearly distinguish the minimum viable solution implemented from any additional stretch goals or features attempted.
- **Live Demonstration** – Demonstrate the working system during evaluation. A recorded demonstration may be used where permitted.

# How to Submit

Submit the project through a **public Git repository**.

The repository must contain a clear and complete README explaining:

- What the project does
- Technologies, libraries, and models used
- How to install dependencies
- How to configure and run the system
- How to reproduce the demonstrated results

The submission link must be submitted by the end of the evaluation.

> A presentation (PPT) is not necessary.

# Rules and Instructions

## Preparation is Allowed

Problem statements have been shared in advance.

Teams may use this time to:

- Understand the problem
- Research relevant technologies
- Plan their approach
- Prepare their development environment

## AI Usage

The use of AI tools is permitted, provided teams:

- Review the generated work
- Understand the generated work
- Take responsibility for everything included in the submitted project

## Declare Your Resources

Teams should clearly mention any significant external resources used, including:

- External APIs
- Datasets
- Pre-trained models
- Open-source components
- Other third-party resources

## Demonstrate Your Work

Teams should be able to:

- Explain their approach
- Demonstrate the working system
- Answer questions about the implementation during evaluation

## Evaluation Integrity

Teams are expected to:

- Work independently
- Maintain the integrity of the evaluation process

Any attempt to access or manipulate:

- Evaluation data
- Hidden test cases

is not permitted.

## Team Conduct

Participants are expected to maintain a respectful and collaborative environment with:

- Fellow participants
- Mentors
- Volunteers
- Organizers

## Organizer's Decision

The evaluation team's decision regarding qualification and judging will be final.
