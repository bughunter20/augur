pragma solidity 0.4.18;

import 'libraries/Initializable.sol';
import 'libraries/DelegationTarget.sol';
import 'reporting/IInitialReporter.sol';
import 'reporting/IMarket.sol';
import 'reporting/BaseReportingParticipant.sol';


contract InitialReporter is DelegationTarget, BaseReportingParticipant, Initializable, IInitialReporter {
    address private designatedReporter;
    address private actualReporter;
    uint256 private reportTimestamp;

    function initialize(IMarket _market, address _designatedReporter) public onlyInGoodTimes beforeInitialized returns (bool) {
        endInitialization();
        market = _market;
        reputationToken = market.getUniverse().getReputationToken();
        cash = market.getDenominationToken();
        designatedReporter = _designatedReporter;
        return true;
    }

    function depositGasBond() public payable returns (bool) {
        return true;
    }

    function redeem(address) public returns (bool) {
        require(isDisavowed() || market.getWinningPayoutDistributionHash() == payoutDistributionHash);
        redeemForAllFeeWindows();
        reputationToken.transfer(actualReporter, reputationToken.balanceOf(this));
        cash.withdrawEtherTo(actualReporter, cash.balanceOf(this));
        return true;
    }

    function report(address _reporter, bytes32 _payoutDistributionHash, uint256[] _payoutNumerators, bool _invalid) public onlyInGoodTimes returns (bool) {
        require(IMarket(msg.sender) == market);
        actualReporter = _reporter;
        payoutDistributionHash = _payoutDistributionHash;
        reportTimestamp = controller.getTimestamp();
        invalid = _invalid;
        payoutNumerators = _payoutNumerators;
        size = market.getReputationToken().balanceOf(this);
        feeWindow = market.getFeeWindow();
        feeWindow.noteInitialReportingGasPrice();
        feeWindow.mintFeeTokens(size);
        return true;
    }

    function fork() public onlyInGoodTimes returns (bool) {
        require(market == market.getUniverse().getForkingMarket());
        IUniverse _newUniverse = market.getUniverse().createChildUniverse(payoutDistributionHash);
        IReputationToken _newReputationToken = _newUniverse.getReputationToken();
        IReputationToken _reputationToken = market.getReputationToken();
        redeemForAllFeeWindows();
        _reputationToken.migrateOut(_newReputationToken, _reputationToken.balanceOf(this));
        reputationToken = _newReputationToken;
        market = IMarket(0);
        return true;
    }

    function resetReportTimestamp() public onlyInGoodTimes returns (bool) {
        require(IMarket(msg.sender) == market);
        if (reportTimestamp == 0) {
            return;
        }
        reportTimestamp = controller.getTimestamp();
        return true;
    }

    function getStake() public view returns (uint256) {
        return size;
    }

    function getDesignatedReporter() public view returns (address) {
        return designatedReporter;
    }

    function getReportTimestamp() public view returns (uint256) {
        return reportTimestamp;
    }

    function designatedReporterShowed() public view returns (bool) {
        return actualReporter == designatedReporter;
    }

    function getFeeWindow() public view returns (IFeeWindow) {
        return feeWindow;
    }
    
    function designatedReporterWasCorrect() public view returns (bool) {
        return payoutDistributionHash == market.getWinningPayoutDistributionHash();
    }
}
