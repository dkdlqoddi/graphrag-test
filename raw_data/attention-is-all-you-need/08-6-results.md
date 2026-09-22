---
doc: "attention-is-all-you-need"
docTitle: "Attention Is All You Need"
chapter: 8
title: "6 Results"
pages: [8,10]
category: "computing"
summary: "Transformer는 기계번역과 영어 구문 분석에서 기존 모델을 크게 능가하며, 적은 학습 비용으로도 높은 성능을 보였다. 또한 어텐션 헤드 수, 차원, 드롭아웃, 위치 인코딩 등 모델 변형이 성능에 미치는 영향을 분석했다."
keywords: ["Transformer","기계번역","BLEU","WMT 2014","어텐션 헤드","beam search","포지셔널 인코딩","드롭아웃","영어 구문 분석","Penn Treebank","P100 GPU","perplexity"]
---

# 6 Results

### 6.1 Machine Translation

On the WMT 2014 English-to-German translation task, the big transformer model (Transformer (big) in Table 2) outperforms the best previously reported models (including ensembles) by more than 2.0 BLEU, establishing a new state-of-the-art BLEU score of 28.4. The configuration of this model is listed in the bottom line of Table 3. Training took 3.5 days on 8 P100 GPUs. Even our base model surpasses all previously published models and ensembles, at a fraction of the training cost of any of the competitive models.

On the WMT 2014 English-to-French translation task, our big model achieves a BLEU score of 41.0, outperforming all of the previously published single models, at less than 1/4 the training cost of the previous state-of-the-art model. The Transformer (big) model trained for English-to-French used dropout rate Pdrop = 0.1, instead of 0.3.

For the base models, we used a single model obtained by averaging the last 5 checkpoints, which were written at 10-minute intervals. For the big models, we averaged the last 20 checkpoints. We used beam search with a beam size of 4 and length penalty α = 0.6 [38]. These hyperparameters were chosen after experimentation on the development set. We set the maximum output length during inference to input length + 50, but terminate early when possible [38]. Table 2 summarizes our results and compares our translation quality and training costs to other model architectures from the literature. We estimate the number of floating point operations used to train a model by multiplying the training time, the number of GPUs used, and an estimate of the sustained single-precision floating-point capacity of each GPU 5.

### 6.2 Model Variations

To evaluate the importance of different components of the Transformer, we varied our base model in different ways, measuring the change in performance on English-to-German translation on the

We used values of 2.8, 3.7, 6.0 and 9.5 TFLOPS for K80, K40, M40 and P100, respectively. Table 3: Variations on the Transformer architecture. Unlisted values are identical to those of the base model. All metrics are on the English-to-German translation development set, newstest2013. Listed perplexities are per-wordpiece, according to our byte-pair encoding, and should not be compared to per-word perplexities.

N dmodel dff h dk dv Pdrop ϵls

train PPL BLEU params

steps (dev) (dev) ×10 base 6 512 2048 8 64 64 0.1 0.1 100K 4.92 25.8 1 512 512

4 128 128 (A)

16 (B)

32 2 4 8 (C)

(D)

(E)

positional embedding instead of sinusoids big 6 1024 4096 16 65

300K 4.33 26.4 213 development set, newstest2013. We used beam search as described in the previous section, but no checkpoint averaging. We present these results in Table 3.

In Table 3 rows (A), we vary the number of attention heads and the attention key and value dimensions, keeping the amount of computation constant, as described in Section 3.2.2. While single-head attention is 0.9 BLEU worse than the best setting, quality also drops off with too many heads. In Table 3 rows (B), we observe that reducing the attention key size dk hurts model quality. This suggests that determining compatibility is not easy and that a more sophisticated compatibility function than dot product may be beneficial. We further observe in rows (C) and (D) that, as expected, bigger models are better, and dropout is very helpful in avoiding over-fitting. In row (E) we replace our sinusoidal positional encoding with learned positional embeddings [9], and observe nearly identical results to the base model.

### 6.3 English Constituency Parsing

To evaluate if the Transformer can generalize to other tasks we performed experiments on English constituency parsing. This task presents specific challenges: the output is subject to strong structural constraints and is significantly longer than the input. Furthermore, RNN sequence-to-sequence models have not been able to attain state-of-the-art results in small-data regimes [37]. We trained a 4-layer transformer with dmodel = 1024 on the Wall Street Journal (WSJ) portion of the Penn Treebank [25], about 40K training sentences. We also trained it in a semi-supervised setting, using the larger high-confidence and BerkleyParser corpora from with approximately 17M sentences [37]. We used a vocabulary of 16K tokens for the WSJ only setting and a vocabulary of 32K tokens for the semi-supervised setting.

We performed only a small number of experiments to select the dropout, both attention and residual (section 5.4), learning rates and beam size on the Section 22 development set, all other parameters remained unchanged from the English-to-German base translation model. During inference, we Table 4: The Transformer generalizes well to English constituency parsing (Results are on Section 23 of WSJ)

Parser Training

WSJ 23 F1 Vinyals & Kaiser el al. (2014) [37] WSJ only, discriminative Petrov et al. (2006) [29]

Zhu et al. (2013) [40]

Dyer et al. (2016) [8]

Transformer (4 layers)

Zhu et al. (2013) [40]

Huang & Harper (2009) [14]

McClosky et al. (2006) [26]

Vinyals & Kaiser el al. (2014) [37]

Transformer (4 layers)

Luong et al. (2015) [23]

Dyer et al. (2016) [8]

88.3 WSJ only, discriminative

90.4 WSJ only, discriminative

90.4 WSJ only, discriminative

91.7 WSJ only, discriminative

91.3 semi-supervised

91.3 semi-supervised

91.3 semi-supervised

92.1 semi-supervised

92.1 semi-supervised

92.7 multi-task

93.0 generative

93.3 increased the maximum output length to input length + 300. We used a beam size of 21 and α = 0.3 for both WSJ only and the semi-supervised setting.

Our results in Table 4 show that despite the lack of task-specific tuning our model performs surprisingly well, yielding better results than all previously reported models with the exception of the Recurrent Neural Network Grammar [8].

In contrast to RNN sequence-to-sequence models [37], the Transformer outperforms the Berkeley- Parser [29] even when training only on the WSJ training set of 40K sentences.
