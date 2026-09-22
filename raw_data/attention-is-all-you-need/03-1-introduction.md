---
doc: "attention-is-all-you-need"
docTitle: "Attention Is All You Need"
chapter: 3
title: "1 Introduction"
pages: [2,2]
category: "computing"
summary: "기존의 순환 신경망과 LSTM, GRU는 시퀀스 모델링과 기계 번역에서 강력했지만, 계산이 순차적이라 병렬화에 한계가 있었다. 이 장에서는 이러한 제약을 대체하기 위해 순환 없이 주의 메커니즘만으로 전역 의존성을 학습하는 Transformer를 제안한다."
keywords: ["Transformer","attention mechanism","sequence modeling","machine translation","recurrent neural networks","LSTM","GRU","encoder-decoder architectures","parallelization","global dependencies","GPU"]
---

# 1 Introduction

Recurrent neural networks, long short-term memory [13] and gated recurrent [7] neural networks in particular, have been firmly established as state of the art approaches in sequence modeling and transduction problems such as language modeling and machine translation [35, 2, 5]. Numerous efforts have since continued to push the boundaries of recurrent language models and encoder-decoder architectures [38, 24, 15].

Recurrent models typically factor computation along the symbol positions of the input and output sequences. Aligning the positions to steps in computation time, they generate a sequence of hidden states ht, as a function of the previous hidden state ht−1 and the input for position t. This inherently sequential nature precludes parallelization within training examples, which becomes critical at longer sequence lengths, as memory constraints limit batching across examples. Recent work has achieved significant improvements in computational efficiency through factorization tricks [21] and conditional computation [32], while also improving model performance in case of the latter. The fundamental constraint of sequential computation, however, remains.

Attention mechanisms have become an integral part of compelling sequence modeling and transduction models in various tasks, allowing modeling of dependencies without regard to their distance in the input or output sequences [2, 19]. In all but a few cases [27], however, such attention mechanisms are used in conjunction with a recurrent network.

In this work we propose the Transformer, a model architecture eschewing recurrence and instead relying entirely on an attention mechanism to draw global dependencies between input and output. The Transformer allows for significantly more parallelization and can reach a new state of the art in translation quality after being trained for as little as twelve hours on eight P100 GPUs.
