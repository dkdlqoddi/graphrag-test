---
doc: "attention-is-all-you-need"
docTitle: "Attention Is All You Need"
chapter: 4
title: "2 Background"
pages: [2,2]
category: "computing"
summary: "이 절은 순차적 계산을 줄이기 위한 기존 모델들(Extended Neural GPU, ByteNet, ConvS2S)과 self-attention의 배경을 설명한다. Transformer가 RNN이나 convolution 없이 self-attention만으로 입력·출력 표현을 계산하는 첫 transduction model임을 강조한다."
keywords: ["Transformer","self-attention","Multi-Head Attention","convolutional neural networks","RNN","ByteNet","ConvS2S","Extended Neural GPU","end-to-end memory networks","sequence-aligned recurrence"]
---

# 2 Background

The goal of reducing sequential computation also forms the foundation of the Extended Neural GPU [16], ByteNet [18] and ConvS2S [9], all of which use convolutional neural networks as basic building block, computing hidden representations in parallel for all input and output positions. In these models, the number of operations required to relate signals from two arbitrary input or output positions grows in the distance between positions, linearly for ConvS2S and logarithmically for ByteNet. This makes it more difficult to learn dependencies between distant positions [12]. In the Transformer this is reduced to a constant number of operations, albeit at the cost of reduced effective resolution due to averaging attention-weighted positions, an effect we counteract with Multi-Head Attention as described in section 3.2.

Self-attention, sometimes called intra-attention is an attention mechanism relating different positions of a single sequence in order to compute a representation of the sequence. Self-attention has been used successfully in a variety of tasks including reading comprehension, abstractive summarization, textual entailment and learning task-independent sentence representations [4, 27, 28, 22]. End-to-end memory networks are based on a recurrent attention mechanism instead of sequencealigned recurrence and have been shown to perform well on simple-language question answering and language modeling tasks [34].

To the best of our knowledge, however, the Transformer is the first transduction model relying entirely on self-attention to compute representations of its input and output without using sequencealigned RNNs or convolution. In the following sections, we will describe the Transformer, motivate self-attention and discuss its advantages over models such as [17, 18] and [9].
