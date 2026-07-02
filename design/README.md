# Pass artwork sources

SVG-in-HTML sources for the Apple pass strip / icons and the Google Wallet hero.
Render with headless Chrome at exact sizes:

    CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "$CHROME" --headless=new --screenshot=strip3x.png --window-size=1125,432 --hide-scrollbars strip_art.html   # strip@3x
    #   750x288 -> strip@2x, 375x144 -> strip.png, 1032x336 -> assets/hero.png (Google)
    "$CHROME" --headless=new --screenshot=icon_big.png --window-size=522,522 --hide-scrollbars icon_art.html
    #   then: sips -z 87 87 / 58 58 / 29 29 for icon@3x/@2x/icon

Mastercard symbol geometry + colours (#EB001B/#F79E1B/#FF5F00) follow
"Mastercard Brand Guidelines_June2024.pdf". Strip background #171717 must match
the pass backgroundColor so the strip blends into the card.
