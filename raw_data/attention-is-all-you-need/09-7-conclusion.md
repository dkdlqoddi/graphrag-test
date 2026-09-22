---
doc: "attention-is-all-you-need"
docTitle: "Attention Is All You Need"
chapter: 9
title: "7 Conclusion"
pages: [10,10]
category: "computing"
summary: "이 장에서는 전적으로 attention에 기반한 sequence transduction 모델인 Transformer를 제안한 성과와 번역 작업에서의 빠른 학습 및 최신 성능을 요약한다. 또한 텍스트를 넘어 이미지·오디오·비디오로의 확장과 더 효율적인 attention 메커니즘에 대한 향후 연구 방향을 제시한다."
keywords: ["Transformer","multi-headed self-attention","sequence transduction","encoder-decoder architectures","WMT 2014","English-to-German translation","English-to-French translation","attention-based models","local restricted attention","tensor2tensor"]
---

# 7 Conclusion

In this work, we presented the Transformer, the first sequence transduction model based entirely on attention, replacing the recurrent layers most commonly used in encoder-decoder architectures with multi-headed self-attention.

For translation tasks, the Transformer can be trained significantly faster than architectures based on recurrent or convolutional layers. On both WMT 2014 English-to-German and WMT 2014 English-to-French translation tasks, we achieve a new state of the art. In the former task our best model outperforms even all previously reported ensembles.

We are excited about the future of attention-based models and plan to apply them to other tasks. We plan to extend the Transformer to problems involving input and output modalities other than text and to investigate local, restricted attention mechanisms to efficiently handle large inputs and outputs such as images, audio and video. Making generation less sequential is another research goals of ours. The code we used to train and evaluate our models is available at https://github.com/ tensorflow/tensor2tensor.

Acknowledgements We are grateful to Nal Kalchbrenner and Stephan Gouws for their fruitful comments, corrections and inspiration.
