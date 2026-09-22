---
doc: "attention-is-all-you-need"
docTitle: "Attention Is All You Need"
chapter: 9
title: "7 Conclusion"
pages: [10,10]
category: "computing"
summary: "이 장은 Transformer를 전적으로 attention에 기반한 첫 sequence transduction model로 정리하며, recurrent layer를 대체해 번역 성능과 학습 속도를 크게 개선했음을 강조한다. 또한 이미지, 오디오, 비디오 등 다른 입력·출력 양식으로의 확장과 더 효율적인 attention 기법의 가능성을 제시한다."
keywords: ["Transformer","Multi-Head Attention","sequence transduction","encoder-decoder architectures","recurrent layers","translation tasks","WMT 2014","local attention mechanisms","images, audio and video","tensor2tensor"]
---

# 7 Conclusion

In this work, we presented the Transformer, the first sequence transduction model based entirely on attention, replacing the recurrent layers most commonly used in encoder-decoder architectures with multi-headed self-attention.

For translation tasks, the Transformer can be trained significantly faster than architectures based on recurrent or convolutional layers. On both WMT 2014 English-to-German and WMT 2014 English-to-French translation tasks, we achieve a new state of the art. In the former task our best model outperforms even all previously reported ensembles.

We are excited about the future of attention-based models and plan to apply them to other tasks. We plan to extend the Transformer to problems involving input and output modalities other than text and to investigate local, restricted attention mechanisms to efficiently handle large inputs and outputs such as images, audio and video. Making generation less sequential is another research goals of ours. The code we used to train and evaluate our models is available at https://github.com/ tensorflow/tensor2tensor.

Acknowledgements We are grateful to Nal Kalchbrenner and Stephan Gouws for their fruitful comments, corrections and inspiration.
