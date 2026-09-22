---
doc: "attention-is-all-you-need"
docTitle: "Attention Is All You Need"
chapter: 7
title: "5 Training"
pages: [7,8]
category: "computing"
summary: "이 장은 Transformer 모델의 학습 절차를 다루며, 데이터 배치, 하드웨어 설정, Adam optimizer, 학습률 스케줄, 그리고 정규화 기법을 설명한다. 또한 dropout과 label smoothing이 BLEU 점수와 학습 성능에 미치는 영향을 정리한다."
keywords: ["Transformer","Adam optimizer","learning rate","label smoothing","Residual Dropout","WMT 2014","byte-pair encoding","batching","warmup_steps","parallelization","BLEU","regularization"]
---

# 5 Training

This section describes the training regime for our models.

### 5.1 Training Data and Batching

We trained on the standard WMT 2014 English-German dataset consisting of about 4.5 million sentence pairs. Sentences were encoded using byte-pair encoding [3], which has a shared sourcetarget vocabulary of about 37000 tokens. For English-French, we used the significantly larger WMT 2014 English-French dataset consisting of 36M sentences and split tokens into a 32000 word-piece vocabulary [38]. Sentence pairs were batched together by approximate sequence length. Each training batch contained a set of sentence pairs containing approximately 25000 source tokens and 25000 target tokens.

### 5.2 Hardware and Schedule

We trained our models on one machine with 8 NVIDIA P100 GPUs. For our base models using the hyperparameters described throughout the paper, each training step took about 0.4 seconds. We trained the base models for a total of 100,000 steps or 12 hours. For our big models,(described on the bottom line of table 3), step time was 1.0 seconds. The big models were trained for 300,000 steps (3.5 days).

### 5.3 Optimizer

We used the Adam optimizer [20] with β = 0.9, β = 0.98 and ϵ = 10−9. We varied the learning

rate over the course of training, according to the formula:

−0.5 2

−0.5

−1.5

lrate = dmodel · min(step_num , step_num · warmup_steps )

(3)

This corresponds to increasing the learning rate linearly for the first warmup_steps training steps, and decreasing it thereafter proportionally to the inverse square root of the step number. We used warmup_steps = 4000.

### 5.4 Regularization

We employ three types of regularization during training: Table 2: The Transformer achieves better BLEU scores than previous state-of-the-art models on the English-to-German and English-to-French newstest2014 tests at a fraction of the training cost.

Model

ByteNet [18]

Deep-Att + PosUnk [39]

GNMT + RL [38]

ConvS2S [9]

MoE [32]

Deep-Att + PosUnk Ensemble [39] GNMT + RL Ensemble [38]

ConvS2S Ensemble [9]

Transformer (base model)

Transformer (big)

BLEU

Training Cost (FLOPs) EN-DE EN-FR

EN-DE EN-FR 23.75

1.0 · 1020

2.3 · 1019 1.4 · 1020

9.6 · 1018 1.5 · 1020

2.0 · 1019 1.2 · 1020 40.4

8.0 · 1020

1.8 · 1020 1.1 · 1021

7.7 · 1019 1.2 · 1021

3.3 · 1018

2.3 · 1019 Residual Dropout We apply dropout [33] to the output of each sub-layer, before it is added to the sub-layer input and normalized. In addition, we apply dropout to the sums of the embeddings and the positional encodings in both the encoder and decoder stacks. For the base model, we use a rate of

Pdrop = 0.1.

Label Smoothing During training, we employed label smoothing of value ϵls = 0.1 [36]. This hurts perplexity, as the model learns to be more unsure, but improves accuracy and BLEU score.
