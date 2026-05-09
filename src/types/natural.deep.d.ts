declare module "natural/lib/natural/sentiment/SentimentAnalyzer.js" {
    export default class SentimentAnalyzer {
        constructor(language: string, stemmer: { stem(value: string): string } | undefined, type: string);
        getSentiment(words: string[]): number;
    }
}

declare module "natural/lib/natural/stemmers/porter_stemmer.js" {
    const stemmer: {
        stem(value: string): string;
    };
    export default stemmer;
}

declare module "natural/lib/natural/tfidf/tfidf.js" {
    interface TfIdfTerm {
        term: string;
        tf: number;
        idf: number;
        tfidf: number;
    }

    export default class TfIdf {
        addDocument(document: string | string[] | Record<string, string>, key?: unknown, restoreCache?: boolean): void;
        listTerms(documentIndex: number): TfIdfTerm[];
    }
}

declare module "natural/lib/natural/tokenizers/regexp_tokenizer.js" {
    export class WordTokenizer {
        tokenize(text: string): string[];
    }
}
