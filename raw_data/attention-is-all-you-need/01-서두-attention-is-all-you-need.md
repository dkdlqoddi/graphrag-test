---
doc: "attention-is-all-you-need"
docTitle: "Attention Is All You Need"
chapter: 1
title: "서두 · Attention Is All You Need"
pages: [1,1]
category: "computing"
summary: "이 장은 기계번역을 포함한 시퀀스 변환 문제를 해결하기 위해 제안된 Transformer와 그 핵심 메커니즘인 attention을 소개한다. RNN이나 CNN 대신 self-attention만으로 병렬화와 성능 향상을 달성하는 방향을 제시한다."
keywords: ["attention","Transformer","self-attention","sequence transduction","machine translation","encoder-decoder","recurrent neural networks","CNN","parallelization","Google Brain"]
---

# 서두 · Attention Is All You Need

## Provided proper attribution is provided, Google hereby grants permission to reproduce the tables and figures in this paper solely for use in journalistic or scholarly works.

## Attention Is All You Need

Ashish Vaswani∗

Noam Shazeer∗ Google Brain

Google Brain Niki Parmar∗

Jakob Uszkoreit∗ Google Research Google Research avaswani@google.com noam@google.com nikip@google.com usz@google.com Llion Jones∗

Aidan N. Gomez∗ † Google Research

University of Toronto Łukasz Kaiser∗

Google Brain llion@google.com aidan@cs.toronto.edu lukaszkaiser@google.com Illia Polosukhin∗ ‡

illia.polosukhin@gmail.com
