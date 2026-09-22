---
doc: "attention-is-all-you-need"
docTitle: "Attention Is All You Need"
chapter: 1
title: "서두 · Attention Is All You Need"
pages: [1,1]
category: "computing"
summary: "이 논문은 시퀀스 변환 문제를 위해 순환 구조나 합성곱 없이 오직 attention만으로 동작하는 Transformer를 제안한다. 병렬 처리와 장거리 의존성 학습의 장점을 통해 기계번역 성능을 크게 향상시키는 것이 핵심이다."
keywords: ["Attention","Transformer","self-attention","sequence transduction","machine translation","encoder-decoder","parallelization","recurrent networks","convolutional networks","long-range dependencies"]
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
