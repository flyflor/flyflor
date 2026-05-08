FROM debian:bookworm-slim

WORKDIR /workspace

RUN useradd --create-home --shell /bin/bash flyflor \
    && chown -R flyflor:flyflor /workspace

USER flyflor

ENTRYPOINT ["flyflor"]
